import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createPool } from './pool.js'
import { migrate } from './migrate.js'
import {
  hashPassword,
  hashGatewayPasscode,
  loadSecurityConfig,
} from '@wepov/security'
import { createHash } from 'node:crypto'

/**
 * Seed script: one class, one super admin, minimal settings.
 *
 * Zero-budget demo data is intentionally minimal (§1.3, §4.3). The class
 * gateway passcode and the super admin's initial password are printed once to
 * stdout. They are not stored in plaintext anywhere.
 *
 * Environment:
 * - SEED_GATEWAY_PASSCODE (default: random 8-char)
 * - SEED_SUPERADMIN_NICKNAME (default: 班长)
 * - SEED_SUPERADMIN_REALNAME (default: 总管理员)
 * - SEED_SUPERADMIN_PASSWORD (default: random 10-char)
 * - SESSION_PEPPER (required for password match tag)
 */

function env(name: string, fallback: string): string {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value : fallback
}

function randomCode(len: number, alphabet: string): string {
  const bytes = createHash('sha256')
    .update(String(Date.now()) + Math.random())
    .digest()
  let out = ''
  for (let i = 0; i < len; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length]
  }
  return out
}

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to seed')
  }
  const pepperRaw = process.env['SESSION_PEPPER']
  if (!pepperRaw) {
    throw new Error('SESSION_PEPPER is required to seed (used for the password match tag)')
  }
  // Derive the exact same keys the API uses at runtime (HKDF domain separation
  // from SESSION_PEPPER unless explicit keys are supplied), so a seeded password
  // and the gateway passcode verify against the running server.
  const security = loadSecurityConfig({
    SESSION_PEPPER: pepperRaw,
    PASSWORD_MATCH_KEY: process.env['PASSWORD_MATCH_KEY'],
    ABUSE_HMAC_KEY: process.env['ABUSE_HMAC_KEY'],
    LOG_IP_HMAC_KEY: process.env['LOG_IP_HMAC_KEY'],
    TREE_IDENTITY_HMAC_KEY: process.env['TREE_IDENTITY_HMAC_KEY'],
    DATA_ENCRYPTION_KEY: process.env['DATA_ENCRYPTION_KEY'],
    DATA_ENCRYPTION_KEY_VERSION: process.env['DATA_ENCRYPTION_KEY_VERSION'],
    DATA_ENCRYPTION_KEY_PREVIOUS: process.env['DATA_ENCRYPTION_KEY_PREVIOUS'],
  })
  const passwordKey = security.passwordMatchKey

  console.log('Running migrations before seed...')
  const applied = await migrate({ connectionString })
  if (applied.length > 0) console.log(`Applied ${applied.length} migration(s).`)

  const pool = createPool({ connectionString, max: 2 })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const existingClass = await client.query<{ id: string }>('SELECT id FROM classes LIMIT 1')
    if (existingClass.rows.length > 0) {
      console.log('A class already exists; seed is idempotent and will not create another.')
      await client.query('ROLLBACK')
      return
    }

    const gatewayPasscode = env(
      'SEED_GATEWAY_PASSCODE',
      randomCode(8, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'),
    )
    // The gateway passcode is stored as a peppered SHA-256 hash; it is a shared
    // barrier, not a per-user credential (§4.1). The pepper is the raw
    // CLASS_GATEWAY_PEPPER (defaults to SESSION_PEPPER), matching the API.
    const gatewayPepper = env('CLASS_GATEWAY_PEPPER', pepperRaw)
    const gatewayHash = hashGatewayPasscode(gatewayPepper, 1, gatewayPasscode)

    const classRow = await client.query<{ id: string }>(
      `INSERT INTO classes (name, gateway_passcode_hash, gateway_passcode_version)
       VALUES ($1, $2, 1) RETURNING id`,
      ['第一人称班级', gatewayHash],
    )
    const classId = classRow.rows[0]!.id

    const nickname = env('SEED_SUPERADMIN_NICKNAME', '班长')
    const realName = env('SEED_SUPERADMIN_REALNAME', '总管理员')
    const initialPassword = env(
      'SEED_SUPERADMIN_PASSWORD',
      randomCode(10, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'),
    )

    const userRow = await client.query<{ id: string }>(
      `INSERT INTO users DEFAULT VALUES RETURNING id`,
    )
    const userId = userRow.rows[0]!.id

    // A placeholder pinyin so the gateway member search can index the super
    // admin immediately. Real imports supply the actual pinyin.
    const realNamePinyin = env('SEED_SUPERADMIN_PINYIN', 'zong guan li yuan')
    const nicknamePinyin = env('SEED_SUPERADMIN_NICKNAME_PINYIN', 'ban zhang')

    await client.query(
      `INSERT INTO class_members (class_id, user_id, student_number, real_name, real_name_pinyin, gender)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [classId, userId, '0001', realName, realNamePinyin, '未设置'],
    )

    const nicknameNorm = nickname.toLowerCase()
    await client.query(
      `INSERT INTO profiles (user_id, class_id, nickname, nickname_norm, nickname_pinyin, birthday_visible)
       VALUES ($1, $2, $3, $4, $5, true)`,
      [userId, classId, nickname, nicknameNorm, nicknamePinyin],
    )

    const record = await hashPassword(passwordKey, initialPassword)
    await client.query(
      `INSERT INTO password_credentials
         (user_id, password_hash, password_length, match_tag, must_change)
       VALUES ($1, $2, $3, $4, true)`,
      [userId, record.hash, record.length, record.matchTag],
    )

    await client.query(
      `INSERT INTO role_assignments (class_id, user_id, role) VALUES ($1, $2, 'super_admin')`,
      [classId, userId],
    )

    await client.query(
      `INSERT INTO storage_usage (class_id, used_bytes, quota_bytes)
       VALUES ($1, 0, $2)`,
      [classId, 9878424780],
    )

    // Minimal settings: idle timeout default, media quota, notification prefs.
    const settings: Array<[string, unknown]> = [
      ['media.quotaBytes', 9878424780],
      ['media.warnRatio', 0.15],
      ['media.blockRatio', 0.05],
      ['gateway.passcodeVersion', 1],
      ['boss.dailyCaps', { focus: 3, resource: 2, answer: 5, mutual_help: 3, challenge: 1 }],
      ['notifications.defaults', { sound: true, badge: true }],
    ]
    for (const [key, value] of settings) {
      await client.query(
        `INSERT INTO app_settings (class_id, key, value) VALUES ($1, $2, $3)`,
        [classId, key, JSON.stringify(value)],
      )
    }

    // A default empty seat layout so the classroom renders before an admin
    // arranges seats.
    await client.query(
      `INSERT INTO seat_layouts (class_id, name, columns, rows, is_active, seats, created_by)
       VALUES ($1, '默认座位', 6, 6, true, '[]'::jsonb, $2)`,
      [classId, userId],
    )

    await client.query('COMMIT')

    console.log('\n=== WePOV seed complete ===')
    console.log(`Class ID:            ${classId}`)
    console.log(`Super admin user ID: ${userId}`)
    console.log(`Super admin login:   ${userId}`)
    console.log(`Super admin password: ${initialPassword}`)
    console.log(`Class gateway passcode: ${gatewayPasscode}`)
    console.log('These values are shown once. Store them safely; they are not stored in plaintext.')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
