import { deriveTenantCode } from '../../src/utils/tenantCode';

describe('deriveTenantCode', () => {
  it('uses first-letter initials for a multi-word name', () => {
    expect(deriveTenantCode('City Model School')).toBe('CMS');
  });

  it('uses the first three letters for a single-word name', () => {
    expect(deriveTenantCode('Educator')).toBe('EDU');
  });

  it('caps multi-word initials at 6 letters', () => {
    expect(deriveTenantCode('The Grand City Public High School Trust')).toBe('TGCPHS');
  });

  it('ignores non-letter characters', () => {
    expect(deriveTenantCode("St. Mary's High School")).toBe('SMHS');
  });

  it('falls back to a generic prefix when the name has no usable letters', () => {
    expect(deriveTenantCode('123 456')).toBe('SCH');
  });

  it('pads a short single word up to the SCH fallback if too short', () => {
    expect(deriveTenantCode('A')).toBe('SCH');
  });

  it('always returns uppercase', () => {
    expect(deriveTenantCode('educator')).toBe('EDU');
  });
});
