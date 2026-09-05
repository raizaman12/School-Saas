/**
 * Central UI string dictionary. The product ships English-only for now
 * (per product decision — Urdu is spoken by end users but the interface
 * language is English), but every user-facing string lives here rather
 * than inline in components specifically so that adding a `ur` dictionary
 * later (Day 13 HCI pass onward) is a data change, not a rewrite. Add new
 * keys here, reference them via `t()`, never hardcode copy in a component.
 */
export const strings = {
  en: {
    app: {
      name: "School Manager",
      tagline: "One simple system for admissions, attendance, fees, and exams — built for schools in Pakistan",
    },
    nav: {
      dashboard: "Dashboard",
      analytics: "Analytics",
      students: "Students",
      academics: "Academics",
      timetable: "Timetable",
      attendance: "Attendance",
      exams: "Exams",
      examGenerator: "Exam Generator",
      fees: "Fees",
      staff: "Staff",
      payroll: "Payroll",
      guardians: "Parents / Guardians",
      notifications: "Notifications",
      notices: "Notices",
      discipline: "Discipline",
      supportNeeds: "Learning Support",
      health: "Health",
      customFields: "Custom Fields",
      leaveRequests: "Leave requests",
      portal: "Parent/Student Portal",
      platformOverview: "Overview",
      platformTenants: "Schools",
      platformPlans: "Plans",
      logout: "Log out",
      changePassword: "Change password",
      myProfile: "My profile",
      settings: "Settings",
      noticeBoard: "Notice Board",
    },
    auth: {
      loginTitle: "Log in to your school",
      loginSubtitle: "Enter your school URL and account details",
      signupTitle: "Register your school",
      signupSubtitle: "Set up your school's account in a few minutes",
      schoolSlug: "School URL",
      schoolName: "School name",
      adminFullName: "Your full name",
      adminEmail: "Email",
      adminPassword: "Password",
      email: "Email",
      // Used only on the login form (see app/login/page.tsx) — every
      // other `auth.email` usage (profile forms, forgot-password,
      // platform-login) stays real-email-only and keeps the plain label.
      emailOrLoginId: "Email or Login ID",
      password: "Password",
      phone: "Phone number",
      loginButton: "Log in",
      signupButton: "Create school account",
      noAccount: "Don't have a school account yet?",
      haveAccount: "Already have a school account?",
      registerLink: "Register your school",
      loginLink: "Log in",
      invalidCredentials: "Invalid email, password, or school URL.",
      platformStaffLink: "Platform staff login",
      platformLoginTitle: "Platform admin sign in",
      platformLoginSubtitle: "For internal staff only",
      backToSchoolLogin: "Back to school login",
      choosePlanTitle: "Choose a plan",
      choosePlanSubtitle: "Start on any tier — you can change it anytime.",
      chooseThemeTitle: "Choose your school's colour",
      chooseThemeSubtitle: "Pick the colour closest to your school's uniform or branding — you can change it anytime from Settings.",
      continueButton: "Continue",
      backButton: "Back",
      changePlan: "Change",
      changePasswordTitle: "Change password",
      changePasswordSubtitle: "Your login email stays the same — only your password changes.",
      currentPassword: "Current password",
      newPassword: "New password",
      confirmNewPassword: "Confirm new password",
      changePasswordButton: "Change password",
      changePasswordSuccess: "Your password has been changed. Please log in again with your new password.",
      passwordMismatch: "New password and confirmation do not match",
      changePasswordError: "Could not change your password. Please try again.",
      forgotPasswordLink: "Forgot your password?",
      forgotPasswordTitle: "Reset your password",
      forgotPasswordSubtitle: "Enter your school URL and login email — we'll send you a reset code.",
      forgotPasswordSendButton: "Send reset code",
      forgotPasswordSentTitle: "Check your email",
      forgotPasswordSentMessage: "If an account exists for that email, a password reset code has been sent to it.",
      forgotPasswordError: "Could not send a reset code. Please try again.",
      resetCode: "Reset code",
      resetPasswordButton: "Reset password",
      resetPasswordSuccess: "Your password has been reset. Please log in with your new password.",
      resetPasswordError: "Could not reset your password. The code may be invalid or expired.",
      backToLogin: "Back to log in",
      profileTitle: "My profile",
      profileSubtitle: "Update your own contact email and phone number.",
      profileSaveSuccess: "Your profile has been updated.",
      profileSaveError: "Could not save your changes. Please try again.",

      // Multi-branch signup — the "One Branch / Multiple Branches" step
      // inserted between the theme picker and the school-details form.
      chooseModeTitle: "How many branches does your school have?",
      chooseModeSubtitle: "You can only set this up now, at registration — branches can't be added later.",
      modeSingleLabel: "One branch",
      modeSingleDescription: "A single school with one login URL.",
      modeMultiLabel: "Multiple branches",
      modeMultiDescription: "Several campuses sharing one login URL, each with its own admin.",
      groupDetailsTitle: "Your school group",
      groupDetailsSubtitle: "This name and URL are shared by every branch — each branch gets its own login page after this.",
      groupSchoolName: "School group name",
      groupSchoolSlug: "Shared login URL",
      groupSchoolSlugHint: "Families and staff will type this URL, then choose their branch.",
      branchesTitle: "Add your branches",
      branchesSubtitle: "Add at least 2 branches. Each one gets its own independent admin account.",
      branchName: "Branch name",
      branchCity: "City",
      branchAdminFullName: "Branch admin's full name",
      branchAdminEmail: "Branch admin's email",
      branchAdminPassword: "Branch admin's password",
      addBranchButton: "Add another branch",
      removeBranchButton: "Remove",
      // Composed with the branch's index in JSX (e.g. "Branch 1") — t()
      // has no string-interpolation support, so this is the prefix only.
      branchLabelPrefix: "Branch",
      multiSignupButton: "Register school group",
      multiSuccessTitle: "Your school group is registered",
      multiSuccessSubtitle: "Share each branch's own login URL with that branch's admin — they'll log in with the email and password you just set.",
      multiSuccessGoToLogin: "Go to log in",

      // Login — multi-branch "Choose your branch" step, shown when the
      // entered/auto-detected URL resolves to a group rather than a
      // single school.
      chooseBranchTitle: "Choose your branch",
      chooseBranchSubtitle: "Pick your branch to continue to its login page.",
      changeBranch: "Change branch",
      // Composed with the resolved branch/group names in JSX (e.g.
      // "Signing in to DHA Campus, Alpha Schools") — see loginTitle's own
      // "Signing in to X" JSX pattern already used for a single school.
      signingInToPrefix: "Signing in to",
    },
    common: {
      loading: "Loading…",
      save: "Save",
      cancel: "Cancel",
      required: "This field is required",
    },
    settings: {
      title: "Settings",
      themeTitle: "School colour theme",
      themeSubtitle: "Pick the colour closest to your school's uniform or branding — it applies across your whole dashboard and portal.",
      themeSaveButton: "Save colour",
      themeSaveSuccess: "Your school's colour theme has been updated.",
      themeSaveError: "Could not save your colour theme. Please try again.",
    },
  },
} as const;

export type Locale = keyof typeof strings;
export const defaultLocale: Locale = "en";
