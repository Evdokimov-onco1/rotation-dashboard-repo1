import { createContext, useContext } from 'react'
import type { FullBootstrap, Role, User, WorkType } from './api'

export interface AppStore {
  boot: FullBootstrap
  reload: () => Promise<void>
}

const Ctx = createContext<AppStore | null>(null)

export function useApp(): AppStore {
  const s = useContext(Ctx)
  if (!s) throw new Error('useApp вне провайдера')
  return s
}

export function useUser(): User {
  return useApp().boot.user
}

export function hasRole(user: User, ...roles: Role[]): boolean {
  return roles.some((r) => user.roles.includes(r))
}

export const canTimetable = (u: User) => hasRole(u, 'office', 'admin')
export const canImport = (u: User) => hasRole(u, 'office', 'admin')
export const canReview = (u: User) => hasRole(u, 'approver')
export const canEditClaims = (u: User) => hasRole(u, 'teacher', 'office', 'admin')
export const isTeacherOnly = (u: User) =>
  u.roles.includes('teacher') && !u.roles.some((r) => r === 'office' || r === 'approver' || r === 'admin')

export function useType(id: string): WorkType | undefined {
  return useApp().boot.types.find((t) => t.id === id)
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Администратор',
  office: 'Учебная часть',
  approver: 'Согласующий',
  teacher: 'Преподаватель',
}

export { Ctx as AppContext }
