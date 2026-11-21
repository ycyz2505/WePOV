import type { ComponentChildren, JSX } from 'preact'
import styles from './Viewfinder.module.css'

interface ViewfinderProps {
  children: ComponentChildren
  class?: string
}

export function Viewfinder({ children, class: className }: ViewfinderProps): JSX.Element {
  return (
    <div class={[styles.viewfinder, className].filter(Boolean).join(' ')}>
      <span class={styles.cornerBottom} aria-hidden="true" />
      {children}
    </div>
  )
}
