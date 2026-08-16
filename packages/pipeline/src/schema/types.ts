import { z } from 'zod';

export const fieldTypeSchema = z.enum(['string', 'number', 'money', 'date', 'enum', 'list']);
export type FieldType = z.infer<typeof fieldTypeSchema>;

const scalarField = z.object({
  type: fieldTypeSchema,
  required: z.boolean().optional(),
  description: z.string().optional(),
  pattern: z.string().optional(),
  format: z.string().optional(),
  values: z.array(z.string()).optional(),
  default: z.unknown().optional(),
  normalize: z
    .object({
      via: z.string(),
      entity_type: z.string().optional(),
    })
    .optional(),
});

const listField = z.object({
  type: z.literal('list'),
  required: z.boolean().optional(),
  description: z.string().optional(),
  element: z.record(z.string(), scalarField),
});

export const fieldDefSchema = z.union([listField, scalarField]);
export type FieldDef = z.infer<typeof fieldDefSchema>;

export const validationRuleSchema = z.object({
  name: z.string(),
  rule: z.string(),
  severity: z.enum(['error', 'warning']),
  applies_if: z.string().optional(),
  message: z.string().optional(),
  suggests: z
    .object({
      field: z.string(),
      value: z.string(),
    })
    .optional(),
});
export type ValidationRule = z.infer<typeof validationRuleSchema>;

export const domainSchemaSchema = z.object({
  name: z.string(),
  version: z.number().int().positive(),
  description: z.string().optional(),
  fields: z.record(z.string(), fieldDefSchema),
  validations: z.array(validationRuleSchema).default([]),
});
export type DomainSchema = z.infer<typeof domainSchemaSchema>;
