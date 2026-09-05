import { maskContact } from '../../src/utils/maskPii';

describe('maskContact', () => {
  it('masks an email local part, keeping the first character and full domain', () => {
    expect(maskContact('ahmed.khan@example.com')).toBe('a*********@example.com');
  });

  it('masks a phone number, keeping only the last 4 digits', () => {
    expect(maskContact('+923001234567')).toBe('*********4567');
  });

  it('handles a short value without throwing', () => {
    expect(maskContact('123')).toBe('***');
  });

  it('never contains the full original value for a realistic phone/email', () => {
    const phone = '03211234567';
    const email = 'parent@school.test';
    expect(maskContact(phone)).not.toBe(phone);
    expect(maskContact(email)).not.toBe(email);
  });
});
