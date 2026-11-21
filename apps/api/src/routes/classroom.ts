import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { getPool, type pg } from '@wepov/database'
import { ApiError, validationError } from '../errors.js'
import { encouragementSchema, focusStartSchema, giftSchema, presenceSchema } from '../schemas.js'
import { avatarUrl } from '../lib/urls.js'
import { createNotification } from '../lib/notifications.js'
import { currentBoss, type BossDto } from './boss.js'
import type { AuthContext } from '../types.js'

interface LayoutRow {
  id: string
  rows: number
  columns: number
  seats: unknown
}

interface SeatDefinition {
  seatIndex: number
  row: number
  col: number
  userId: string | null
}

interface MemberRow {
  user_id: string
  nickname: string
  gender: string
  avatar_object_key: string | null
  presence_status: 'focus' | 'resting' | 'offline'
  focus_until: Date | null
  focus_note: string | null
}

interface FocusRow {
  id: string
  user_id: string
  class_id: string
  started_at: Date
  ends_at: Date
  duration_minutes: number
  note: string
}

interface ClassroomSeatDto {
  seatId: string
  row: number
  column: number
  userId: string | null
  nickname: string | null
  avatarUrl: string | null
  gender: string | null
  presence: 'focus' | 'rest' | 'offline'
  focusUntil: string | null
  focusNote: string | null
}

interface ClassroomLayoutDto {
  rows: number
  columns: number
  seats: ClassroomSeatDto[]
  boss: BossDto | null
  me: ClassroomSeatDto | null
}

function parseSeatDefinitions(value: unknown): SeatDefinition[] {
  if (!Array.isArray(value)) return []
  const seats: SeatDefinition[] = []
  for (const [fallbackIndex, raw] of value.entries()) {
    if (typeof raw !== 'object' || raw === null) continue
    const item = raw as Record<string, unknown>
    const seatIndex = Number(item['seatIndex'] ?? fallbackIndex)
    const row = Number(item['row'])
    const col = Number(item['col'] ?? item['column'])
    const userId = typeof item['userId'] === 'string' ? item['userId'] : null
    if (!Number.isInteger(seatIndex) || !Number.isInteger(row) || !Number.isInteger(col)) continue
    seats.push({ seatIndex, row, col, userId })
  }
  return seats
}

async function awardFocusPoint(
  client: pg.PoolClient,
  focus: Pick<FocusRow, 'id' | 'user_id' | 'class_id'>,
): Promise<void> {
  const seasonResult = await client.query<{
    id: string
    target_points: number
    current_points: number
    daily_caps: Record<string, unknown> | null
  }>(
    `SELECT id, target_points, current_points, daily_caps
       FROM boss_seasons
      WHERE class_id = $1 AND status = 'active' AND starts_at <= now() AND ends_at > now()
      FOR UPDATE`,
    [focus.class_id],
  )
  const season = seasonResult.rows[0]
  if (!season) return

  const configuredCap = Number(season.daily_caps?.['focus'])
  const cap = Number.isInteger(configuredCap) && configuredCap > 0 ? configuredCap : 3
  const countResult = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM boss_contributions
      WHERE season_id = $1 AND user_id = $2 AND kind = 'focus'
        AND contribution_day = (now() AT TIME ZONE 'UTC')::date
        AND revoked_at IS NULL`,
    [season.id, focus.user_id],
  )
  if (Number(countResult.rows[0]?.count ?? 0) >= cap) return

  const inserted = await client.query(
    `INSERT INTO boss_contributions
       (class_id, season_id, user_id, kind, points, source_ref)
     VALUES ($1,$2,$3,'focus',10,$4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [focus.class_id, season.id, focus.user_id, `focus:${focus.id}`],
  )
  if ((inserted.rowCount ?? 0) === 0) return

  await client.query(
    `UPDATE boss_seasons
        SET current_points = current_points + 10,
            status = CASE WHEN current_points + 10 >= target_points THEN 'completed' ELSE status END
      WHERE id = $1`,
    [season.id],
  )
}

async function finalizeExpiredFocus(classId: string): Promise<void> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const expired = await client.query<FocusRow>(
      `UPDATE focus_sessions
          SET completed_at = ends_at
        WHERE class_id = $1 AND completed_at IS NULL AND cancelled_at IS NULL AND ends_at <= now()
      RETURNING id, user_id, class_id, started_at, ends_at, duration_minutes, note`,
      [classId],
    )
    for (const focus of expired.rows) await awardFocusPoint(client, focus)
    if (expired.rows.length > 0) {
      await client.query(
        `UPDATE class_members cm
            SET presence_status = 'resting', presence_updated_at = now()
          WHERE cm.class_id = $1 AND cm.user_id = ANY($2::uuid[])
            AND cm.presence_status = 'focus'
            AND NOT EXISTS (
              SELECT 1 FROM focus_sessions fs
               WHERE fs.user_id = cm.user_id AND fs.class_id = cm.class_id
                 AND fs.completed_at IS NULL AND fs.cancelled_at IS NULL AND fs.ends_at > now()
            )`,
        [classId, expired.rows.map((row) => row.user_id)],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function loadLayout(app: FastifyInstance, auth: AuthContext): Promise<ClassroomLayoutDto> {
  await finalizeExpiredFocus(auth.classId)
  const layoutResult = await getPool().query<LayoutRow>(
    `SELECT id, rows, columns, seats
       FROM seat_layouts
      WHERE class_id = $1 AND is_active = true
      LIMIT 1`,
    [auth.classId],
  )
  const layout = layoutResult.rows[0]
  const boss = await currentBoss(app, auth)
  if (!layout) return { rows: 0, columns: 0, seats: [], boss, me: null }

  const definitions = parseSeatDefinitions(layout.seats)
  const userIds = [...new Set(definitions.flatMap((seat) => (seat.userId ? [seat.userId] : [])))]
  const members = userIds.length === 0
    ? []
    : (
        await getPool().query<MemberRow>(
          `SELECT cm.user_id, p.nickname, cm.gender, p.avatar_object_key, cm.presence_status,
                  fs.ends_at AS focus_until, fs.note AS focus_note
             FROM class_members cm
             JOIN users u ON u.id = cm.user_id AND u.is_active = true AND u.deleted_at IS NULL
             JOIN profiles p ON p.user_id = cm.user_id AND p.class_id = cm.class_id
             LEFT JOIN LATERAL (
               SELECT ends_at, note FROM focus_sessions
                WHERE class_id = cm.class_id AND user_id = cm.user_id
                  AND completed_at IS NULL AND cancelled_at IS NULL AND ends_at > now()
                ORDER BY started_at DESC LIMIT 1
             ) fs ON true
            WHERE cm.class_id = $1 AND cm.user_id = ANY($2::uuid[]) AND cm.hidden = false`,
          [auth.classId, userIds],
        )
      ).rows
  const memberMap = new Map(members.map((member) => [member.user_id, member]))
  const seats: ClassroomSeatDto[] = await Promise.all(
    definitions.map(async (definition) => {
      const member = definition.userId ? memberMap.get(definition.userId) : undefined
      const presence = member?.focus_until
        ? 'focus'
        : member?.presence_status === 'resting'
          ? 'rest'
          : member?.presence_status === 'focus'
            ? 'rest'
            : 'offline'
      return {
        seatId: `${layout.id}:${definition.seatIndex}`,
        row: definition.row,
        column: definition.col,
        userId: member?.user_id ?? null,
        nickname: member?.nickname ?? null,
        avatarUrl: member ? await avatarUrl(app, member.avatar_object_key) : null,
        gender: member?.gender ?? null,
        presence,
        focusUntil: member?.focus_until?.toISOString() ?? null,
        focusNote: member?.focus_note ?? null,
      }
    }),
  )
  return {
    rows: layout.rows,
    columns: layout.columns,
    seats,
    boss,
    me: seats.find((seat) => seat.userId === auth.userId) ?? null,
  }
}

async function recipientNickname(classId: string, userId: string): Promise<string> {
  const result = await getPool().query<{ nickname: string }>(
    `SELECT p.nickname
       FROM class_members cm
       JOIN users u ON u.id = cm.user_id AND u.is_active = true AND u.deleted_at IS NULL
       JOIN profiles p ON p.user_id = cm.user_id AND p.class_id = cm.class_id
      WHERE cm.class_id = $1 AND cm.user_id = $2 AND cm.hidden = false`,
    [classId, userId],
  )
  const row = result.rows[0]
  if (!row) throw ApiError.notFound('member_not_found', '同学不存在')
  return row.nickname
}

export const classroomRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/classroom/layout', async (request) => {
    const auth = app.requireAuth(request)
    return loadLayout(app, auth)
  })

  app.put('/api/v1/classroom/presence', async (request) => {
    const auth = app.requireAuth(request)
    const parsed = presenceSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    const stored = parsed.data.presence === 'rest' ? 'resting' : parsed.data.presence
    await getPool().query(
      `UPDATE class_members
          SET presence_status = $3, presence_updated_at = now()
        WHERE class_id = $1 AND user_id = $2`,
      [auth.classId, auth.userId, stored],
    )
    return loadLayout(app, auth)
  })

  app.post('/api/v1/classroom/focus', async (request) => {
    const auth = app.requireAuth(request)
    const parsed = focusStartSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    await finalizeExpiredFocus(auth.classId)

    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [auth.userId])
      const existing = await client.query(
        `SELECT 1 FROM focus_sessions
          WHERE class_id = $1 AND user_id = $2
            AND completed_at IS NULL AND cancelled_at IS NULL AND ends_at > now()
          LIMIT 1`,
        [auth.classId, auth.userId],
      )
      if ((existing.rowCount ?? 0) > 0) throw ApiError.conflict('focus_active', '已有进行中的专注')
      const result = await client.query<FocusRow>(
        `INSERT INTO focus_sessions (class_id, user_id, duration_minutes, note, ends_at)
         VALUES ($1,$2,$3,$4, now() + ($3 * interval '1 minute'))
         RETURNING id, user_id, class_id, started_at, ends_at, duration_minutes, note`,
        [auth.classId, auth.userId, parsed.data.durationMinutes, parsed.data.note],
      )
      await client.query(
        `UPDATE class_members SET presence_status = 'focus', presence_updated_at = now()
          WHERE class_id = $1 AND user_id = $2`,
        [auth.classId, auth.userId],
      )
      await client.query('COMMIT')
      const focus = result.rows[0]!
      return {
        id: focus.id,
        durationMinutes: focus.duration_minutes,
        note: focus.note,
        startedAt: focus.started_at.toISOString(),
        endsAt: focus.ends_at.toISOString(),
        active: true,
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  app.delete('/api/v1/classroom/focus', async (request, reply) => {
    const auth = app.requireAuth(request)
    const client = await getPool().connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [auth.userId])
      const result = await client.query<FocusRow>(
        `SELECT id, user_id, class_id, started_at, ends_at, duration_minutes, note
           FROM focus_sessions
          WHERE class_id = $1 AND user_id = $2
            AND completed_at IS NULL AND cancelled_at IS NULL
          ORDER BY started_at DESC LIMIT 1 FOR UPDATE`,
        [auth.classId, auth.userId],
      )
      const focus = result.rows[0]
      if (focus) {
        const completed = Date.now() - focus.started_at.getTime() >= 5 * 60 * 1000
        await client.query(
          completed
            ? `UPDATE focus_sessions SET completed_at = now() WHERE id = $1`
            : `UPDATE focus_sessions SET cancelled_at = now() WHERE id = $1`,
          [focus.id],
        )
        if (completed) await awardFocusPoint(client, focus)
      }
      await client.query(
        `UPDATE class_members SET presence_status = 'resting', presence_updated_at = now()
          WHERE class_id = $1 AND user_id = $2`,
        [auth.classId, auth.userId],
      )
      await client.query('COMMIT')
      reply.status(204).send()
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  })

  app.post('/api/v1/classroom/encouragements', async (request, reply) => {
    const auth = app.requireAuth(request)
    const parsed = encouragementSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    if (parsed.data.recipientId === auth.userId) throw ApiError.badRequest('self_target', '不能给自己发送鼓励')
    await recipientNickname(auth.classId, parsed.data.recipientId)
    await getPool().query(
      `INSERT INTO encouragement_notes (class_id, sender_id, recipient_id, kind, message)
       VALUES ($1,$2,$3,$4,$5)`,
      [auth.classId, auth.userId, parsed.data.recipientId, parsed.data.kind, parsed.data.message],
    )
    const body = parsed.data.kind === 'note'
      ? parsed.data.message
      : parsed.data.kind === 'snack'
        ? '有人给你送来了一份虚拟零食。'
        : '有人为你的座位点亮了一盏台灯。'
    await createNotification(app.notifications, {
      classId: auth.classId,
      userId: parsed.data.recipientId,
      kind: 'encouragement',
      title: '收到一份匿名鼓励',
      body,
      href: '/classroom',
    })
    reply.status(204).send()
  })

  app.post('/api/v1/classroom/gifts', async (request, reply) => {
    const auth = app.requireAuth(request)
    const parsed = giftSchema.safeParse(request.body)
    if (!parsed.success) throw validationError(parsed.error.issues)
    if (parsed.data.recipientId === auth.userId) throw ApiError.badRequest('self_target', '不能给自己发送礼物')
    await recipientNickname(auth.classId, parsed.data.recipientId)
    await getPool().query(
      `INSERT INTO virtual_gifts (class_id, sender_id, recipient_id, gift_key)
       VALUES ($1,$2,$3,$4)`,
      [auth.classId, auth.userId, parsed.data.recipientId, parsed.data.gift],
    )
    await createNotification(app.notifications, {
      classId: auth.classId,
      userId: parsed.data.recipientId,
      kind: 'gift',
      title: '收到一份礼物',
      body: `有人送给你「${parsed.data.gift}」。`,
      href: '/classroom',
    })
    reply.status(204).send()
  })
}
