export const loginPath = '/auth/login'
export const loginCallbackPath = '/auth/callback'
export const logoutPath = '/auth/logout'
export const signedOutPath = '/auth/signed-out'

/** An area's own signed out page, which logout lands on when the area asks for it by `next`. */
export const devOpsSignedOutPath = '/dev-ops/signed-out'

export const signedOutPaths = [signedOutPath, devOpsSignedOutPath]
