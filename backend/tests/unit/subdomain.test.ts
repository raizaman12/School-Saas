import { isSubdomainOfOrigin } from '../../src/utils/subdomain';

describe('isSubdomainOfOrigin', () => {
  it('accepts an origin whose host is a single-level subdomain of the wildcard domain', () => {
    expect(isSubdomainOfOrigin('http://alpha-school.localhost:3000', 'localhost:3000')).toBe(true);
    expect(isSubdomainOfOrigin('https://beta-school.yourschoolsaas.com', 'yourschoolsaas.com')).toBe(true);
  });

  it('rejects the bare wildcard domain itself (not a subdomain of itself)', () => {
    expect(isSubdomainOfOrigin('http://localhost:3000', 'localhost:3000')).toBe(false);
  });

  it('rejects an unrelated origin', () => {
    expect(isSubdomainOfOrigin('http://evil.com', 'localhost:3000')).toBe(false);
  });

  it('rejects an origin that merely contains the domain as a suffix of a longer label', () => {
    expect(isSubdomainOfOrigin('http://notlocalhost:3000', 'localhost:3000')).toBe(false);
  });

  it('rejects multi-level subdomains', () => {
    expect(isSubdomainOfOrigin('http://a.b.localhost:3000', 'localhost:3000')).toBe(false);
  });

  it('rejects a malformed origin header', () => {
    expect(isSubdomainOfOrigin('not-a-url', 'localhost:3000')).toBe(false);
  });

  it('rejects when the wildcard domain is empty', () => {
    expect(isSubdomainOfOrigin('http://alpha-school.localhost:3000', '')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isSubdomainOfOrigin('http://Alpha-School.LOCALHOST:3000', 'localhost:3000')).toBe(true);
  });
});
