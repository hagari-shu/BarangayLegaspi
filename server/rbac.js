export function authorizeRole(requiredRole, user) {
  if (!user) return false
  return user.role === requiredRole || user.role === 'admin'
}

export function getAccessProfile(user) {
  return {
    isResident: user?.role === 'resident',
    isStaff: user?.role === 'staff',
    isAdmin: user?.role === 'admin',
    isAuthenticated: Boolean(user),
  }
}
