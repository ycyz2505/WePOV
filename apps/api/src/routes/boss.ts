import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { getPool } from '@wepov/database'
import type { AuthContext } from '../types.js'

interface BossRow {
  id: string
  name: string
  target_points: number
  current_points: number
  starts_at: Date
  ends_at: Date
  reward: string
  status: 'scheduled' | 'active' | 'completed' | 'cancelled'
}

export interface BossDto {
  id: string
  name: string
  description: string
  targetPoints: number
  currentPoints: number
  startsAt: string
  endsAt: string
  reward: string
  status: 'upcoming' | 'active' | 'ended'
}

function toBoss(row: BossRow): BossDto {
  return {
    id: row.id,
    name: row.name,
    description: '',
    targetPoints: row.target_points,
    currentPoints: row.current_points,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    reward: row.reward,
    status: row.status === 'scheduled' ? 'upcoming' : row.status === 'active' ? 'active' : 'ended',
  }
}

export async function currentBoss(_app: FastifyInstance, auth: AuthContext): Promise<BossDto | null> {
  const result = await getPool().query<BossRow>(
    `SELECT id, name, target_points, current_points, starts_at, ends_at, reward, status
       FROM boss_seasons
      WHERE class_id = $1 AND status <> 'cancelled'
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
               CASE WHEN status = 'completed' THEN ends_at END DESC NULLS LAST,
               starts_at ASC
      LIMIT 1`,
    [auth.classId],
  )
  const row = result.rows[0]
  return row ? toBoss(row) : null
}

export const bossRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/boss/current', async (request) => {
    const auth = app.requireAuth(request)
    return currentBoss(app, auth)
  })
}
