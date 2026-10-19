export function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin'
}

export function isSuperAdminRole(role) {
  return role === 'super_admin'
}

export function isStaffOrAdminRole(role) {
  return role === 'staff' || isAdminRole(role)
}

export function authorizeRole(requiredRole, user) {
  if (!user) return false
  return user.role === requiredRole || (requiredRole === 'admin' && isAdminRole(user.role))
}

export function getAccessProfile(user) {
  return {
    isResident: user?.role === 'resident',
    isStaff: user?.role === 'staff',
    isAdmin: isAdminRole(user?.role),
    isSuperAdmin: isSuperAdminRole(user?.role),
    isAuthenticated: Boolean(user),
  }
}
