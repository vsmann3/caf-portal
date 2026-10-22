import { z } from "zod";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Valid email required"),
  password: z.string().min(1, "Password required"),
});

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

export const companyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4,12}$/, "4–12 letters/digits, uppercase");

export const createCompanySchema = z.object({
  name: z.string().trim().min(2, "Company name required").max(120),
  companyCode: companyCodeSchema.optional(),
  contactEmail: z.string().trim().email().or(z.literal("")).optional(),
  contactPhone: z.string().trim().max(20).or(z.literal("")).optional(),
  address: z.string().trim().max(500).or(z.literal("")).optional(),
});

export const updateCompanySchema = createCompanySchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Franchise
// ---------------------------------------------------------------------------

export const createFranchiseSchema = z.object({
  companyId: z.string().min(1).optional(), // super admin may target any company
  name: z.string().trim().min(2, "Franchise name required").max(120),
  code: z.string().trim().max(40).or(z.literal("")).optional(),
  ownerName: z.string().trim().max(120).or(z.literal("")).optional(),
  email: z.string().trim().email().or(z.literal("")).optional(),
  phone: z.string().trim().max(20).or(z.literal("")).optional(),
  address: z.string().trim().max(500).or(z.literal("")).optional(),
  city: z.string().trim().max(100).or(z.literal("")).optional(),
});

export const updateFranchiseSchema = createFranchiseSchema
  .omit({ companyId: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "Name required").max(120),
  email: z.string().trim().toLowerCase().email("Valid email required"),
  password: z.string().min(8, "Minimum 8 characters"),
  role: z.enum(["COMPANY_ADMIN", "FRANCHISE_USER"]),
  companyId: z.string().min(1, "Company required"),
  franchiseId: z.string().min(1).optional().nullable(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  password: z.string().min(8).optional(),
  isActive: z.boolean().optional(),
  franchiseId: z.string().min(1).optional().nullable(),
});

// ---------------------------------------------------------------------------
// CAF (Customer Application Form)
// ---------------------------------------------------------------------------

export const createApplicationSchema = z.object({
  franchiseId: z.string().min(1, "Franchise required"),
  customerName: z.string().trim().min(2, "Customer name required").max(150),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().nullable(),
  dob: z.coerce.date().optional().nullable(),
  fatherName: z.string().trim().max(150).or(z.literal("")).optional(),
  mobile: z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, "10-digit Indian mobile number"),
  email: z.string().trim().email().or(z.literal("")).optional(),
  altPhone: z.string().trim().max(20).or(z.literal("")).optional(),
  addressLine1: z.string().trim().min(3, "Address required").max(300),
  addressLine2: z.string().trim().max(300).or(z.literal("")).optional(),
  city: z.string().trim().min(2, "City required").max(100),
  state: z.string().trim().min(2, "State required").max(100),
  pincode: z.string().trim().regex(/^\d{6}$/, "6-digit PIN code"),
  idProofType: z.enum(["AADHAAR", "PAN", "VOTER_ID", "PASSPORT", "DRIVING_LICENSE", "OTHER"]),
  idNumber: z.string().trim().min(3, "ID number required").max(40),
  connectionType: z.enum(["NEW", "RELOCATION", "CHANGE_OF_PLAN", "TRANSFER"]),
  customerType: z.enum(["RESIDENTIAL", "COMMERCIAL"]).optional(),
  planName: z.string().trim().max(100).or(z.literal("")).optional(),
  bandwidth: z.string().trim().max(50).or(z.literal("")).optional(),
  connectionAddress: z.string().trim().max(500).or(z.literal("")).optional(),
  broadbandUsername: z.string().trim().max(100).or(z.literal("")).optional(),
  remarks: z.string().trim().max(1000).or(z.literal("")).optional(),
  businessName: z.string().trim().max(150).optional(),
  gstNumber: z.string().trim().toUpperCase().regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GST number").optional(),
  billingAddressLine1: z.string().trim().min(3, "Billing address required").max(300),
  billingAddressLine2: z.string().trim().max(300).optional(),
  billingCity: z.string().trim().min(2, "Billing city required").max(100),
  billingState: z.string().trim().min(2, "Billing state required").max(100),
  billingPincode: z.string().regex(/^[1-9]\d{5}$/, "Billing PIN must have 6 digits"),
  declarationAccepted: z.literal(true, { errorMap: () => ({ message: "Confirm the submission declaration" }) }),
  radiusDemoIntentId: z.string().uuid().optional(),
  draftId: z.string().optional(),
  draftVersion: z.number().int().positive().optional(),
  applicationId: z.string().optional(),
  revision: z.number().int().positive().optional(),
}).superRefine((data, ctx) => {
  if (data.customerType === "COMMERCIAL") {
    if (!data.businessName) ctx.addIssue({ code: "custom", path: ["businessName"], message: "Business name required" });
    if (!data.gstNumber) ctx.addIssue({ code: "custom", path: ["gstNumber"], message: "GST number required for business CAFs" });
  }
});

export const reviewApplicationSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "UNDER_REVIEW"]),
  rejectionReason: z.string().trim().max(1000).or(z.literal("")).optional(),
});

// ---------------------------------------------------------------------------
// Storage settings (super admin only)
// ---------------------------------------------------------------------------

export const storageSettingsSchema = z.object({
  provider: z.enum(["local", "s3"]),
  local: z
    .object({
      basePath: z.string().trim().min(1, "Base path required"),
    })
    .optional(),
  s3: z
    .object({
      bucket: z.string().trim().min(1, "Bucket required"),
      region: z.string().trim().min(1, "Region required"),
      endpoint: z.string().trim().or(z.literal("")).optional(), // for MinIO etc.
      accessKeyId: z.string().trim().min(1, "Access key required"),
      secretAccessKey: z.string().trim().min(1, "Secret key required"),
      forcePathStyle: z.boolean().optional(),
    })
    .optional(),
});
