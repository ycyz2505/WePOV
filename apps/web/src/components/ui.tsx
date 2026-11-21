import type { JSX } from 'preact'
import { useId } from 'preact/hooks'
import { Icon, type IconName } from './Icon'
import { avatarGradient, initialOf } from '../lib/format'
import { cn } from '../lib/cn'
import ui from './ui.module.css'

type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'quiet'

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  block?: boolean
  iconOnly?: boolean
  loading?: boolean
}

const variantClass: Record<ButtonVariant, string> = {
  default: '',
  primary: ui.btnPrimary,
  ghost: ui.btnGhost,
  danger: ui.btnDanger,
  quiet: ui.btnQuiet,
}

export function Button({
  variant = 'default',
  size = 'md',
  block,
  iconOnly,
  loading,
  class: className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      type={type}
      class={cn(
        ui.btn,
        variantClass[variant],
        size === 'sm' && ui.btnSm,
        block && ui.btnBlock,
        iconOnly && ui.btnIcon,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading ? 'true' : undefined}
      {...rest}
    >
      {children}
    </button>
  )
}

interface FieldProps {
  label: string
  hint?: string
  error?: string
  htmlFor?: string
  required?: boolean
  children: JSX.Element
  counter?: { value: number; max: number }
}

export function Field({ label, hint, error, htmlFor, required, children, counter }: FieldProps): JSX.Element {
  return (
    <div class={ui.field}>
      <label class={ui.label} for={htmlFor}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {counter ? (
        <div class={cn(ui.counter, counter.value > counter.max && ui.counterOver)}>
          {counter.value} / {counter.max}
        </div>
      ) : null}
      {error ? (
        <p class={ui.fieldError} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p class={ui.hint}>{hint}</p>
      ) : null}
    </div>
  )
}

interface TextFieldProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'class'> {
  label: string
  hint?: string
  error?: string
  counterMax?: number
  class?: string
}

export function TextField({
  label,
  hint,
  error,
  id,
  counterMax,
  value,
  class: className,
  required,
  ...rest
}: TextFieldProps): JSX.Element {
  const autoId = useId()
  const fieldId = id ?? autoId
  const stringValue = typeof value === 'string' ? value : ''
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      htmlFor={fieldId}
      required={required}
      counter={counterMax ? { value: Array.from(stringValue).length, max: counterMax } : undefined}
    >
      <input
        id={fieldId}
        class={cn(ui.input, error && ui.inputError, className)}
        value={value}
        aria-invalid={error ? 'true' : undefined}
        required={required}
        {...rest}
      />
    </Field>
  )
}

interface TextAreaProps extends Omit<JSX.TextareaHTMLAttributes<HTMLTextAreaElement>, 'class'> {
  label: string
  hint?: string
  error?: string
  counterMax?: number
  class?: string
}

export function TextArea({
  label,
  hint,
  error,
  id,
  counterMax,
  value,
  class: className,
  required,
  ...rest
}: TextAreaProps): JSX.Element {
  const autoId = useId()
  const fieldId = id ?? autoId
  const stringValue = typeof value === 'string' ? value : ''
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      htmlFor={fieldId}
      required={required}
      counter={counterMax ? { value: Array.from(stringValue).length, max: counterMax } : undefined}
    >
      <textarea
        id={fieldId}
        class={cn(ui.textarea, error && ui.inputError, className)}
        value={value}
        aria-invalid={error ? 'true' : undefined}
        required={required}
        {...rest}
      />
    </Field>
  )
}

export function Badge({
  tone = 'default',
  children,
}: {
  tone?: 'default' | 'accent' | 'sunset' | 'danger' | 'success'
  children: JSX.Element | string
}): JSX.Element {
  const toneClass = {
    default: '',
    accent: ui.badgeAccent,
    sunset: ui.badgeSunset,
    danger: ui.badgeDanger,
    success: ui.badgeSuccess,
  }[tone]
  return <span class={cn(ui.badge, toneClass)}>{children}</span>
}

interface AvatarProps {
  name: string
  src?: string | null
  seed?: string
  size?: number
  class?: string
}

export function Avatar({ name, src, seed, size = 40, class: className }: AvatarProps): JSX.Element {
  const background = avatarGradient(seed ?? name)
  return (
    <span
      class={cn(ui.avatar, className)}
      style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px`, background }}
      aria-hidden={src ? undefined : 'true'}
    >
      {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : initialOf(name)}
    </span>
  )
}

export function Skeleton({ width, height, radius }: { width?: string; height?: number; radius?: number }): JSX.Element {
  return (
    <span
      class={ui.skeleton}
      style={{ display: 'block', width: width ?? '100%', height: `${height ?? 16}px`, borderRadius: radius ? `${radius}px` : undefined }}
      aria-hidden="true"
    />
  )
}

interface StateBlockProps {
  icon?: IconName
  title: string
  body?: string
  children?: JSX.Element | JSX.Element[]
  tone?: 'neutral' | 'danger'
}

export function StateBlock({ icon = 'info', title, body, children, tone = 'neutral' }: StateBlockProps): JSX.Element {
  return (
    <div class={ui.stateBlock}>
      <span class={ui.stateIcon} style={tone === 'danger' ? { color: 'var(--annotation)' } : undefined}>
        <Icon name={icon} size={28} />
      </span>
      <p class={ui.stateTitle}>{title}</p>
      {body ? <p class={ui.stateBody}>{body}</p> : null}
      {children ? <div class={ui.stateActions}>{children}</div> : null}
    </div>
  )
}

interface NoticeProps {
  tone?: 'default' | 'info' | 'warn' | 'danger' | 'success'
  icon?: IconName
  children: JSX.Element | JSX.Element[] | string
}

export function Notice({ tone = 'default', icon, children }: NoticeProps): JSX.Element {
  const toneClass = {
    default: '',
    info: ui.noticeInfo,
    warn: ui.noticeWarn,
    danger: ui.noticeDanger,
    success: ui.noticeSuccess,
  }[tone]
  const defaultIcon: IconName = tone === 'danger' ? 'alert' : tone === 'warn' ? 'alert' : 'info'
  return (
    <div class={cn(ui.notice, toneClass)} role={tone === 'danger' ? 'alert' : undefined}>
      <span class={ui.noticeIcon}>
        <Icon name={icon ?? defaultIcon} size={18} />
      </span>
      <div>{children}</div>
    </div>
  )
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: JSX.Element
}): JSX.Element {
  return (
    <div class={ui.sectionHead}>
      <div>
        <h2 class={ui.sectionTitle}>{title}</h2>
        {subtitle ? <p class={ui.sectionSub}>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function Chip({
  active,
  onClick,
  children,
  ...rest
}: {
  active?: boolean
  onClick?: () => void
  children: JSX.Element | string
} & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>): JSX.Element {
  return (
    <button
      type="button"
      class={cn(ui.chip, active && ui.chipActive)}
      aria-pressed={active ? 'true' : 'false'}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Dots(): JSX.Element {
  return (
    <span class={ui.dots} aria-label="加载中">
      <span />
      <span />
      <span />
    </span>
  )
}

export { ui }
