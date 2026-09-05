import { describe, it, expect } from "vitest";
import { extractTenantSlugFromHost, buildTenantLoginUrl } from "./subdomain";

describe("extractTenantSlugFromHost", () => {
  it("extracts the slug from a school subdomain", () => {
    expect(extractTenantSlugFromHost("alpha-school.yourschoolsaas.com", "yourschoolsaas.com")).toBe(
      "alpha-school",
    );
  });

  it("works with a port in the app domain (local dev)", () => {
    expect(extractTenantSlugFromHost("alpha-school.localhost:3000", "localhost:3000")).toBe("alpha-school");
  });

  it("returns null for the bare app domain", () => {
    expect(extractTenantSlugFromHost("yourschoolsaas.com", "yourschoolsaas.com")).toBeNull();
    expect(extractTenantSlugFromHost("localhost:3000", "localhost:3000")).toBeNull();
  });

  it("returns null for reserved subdomains", () => {
    expect(extractTenantSlugFromHost("www.yourschoolsaas.com", "yourschoolsaas.com")).toBeNull();
    expect(extractTenantSlugFromHost("api.yourschoolsaas.com", "yourschoolsaas.com")).toBeNull();
    expect(extractTenantSlugFromHost("app.yourschoolsaas.com", "yourschoolsaas.com")).toBeNull();
  });

  it("returns null for an unrelated host", () => {
    expect(extractTenantSlugFromHost("evil.com", "yourschoolsaas.com")).toBeNull();
    expect(extractTenantSlugFromHost("notyourschoolsaas.com", "yourschoolsaas.com")).toBeNull();
  });

  it("returns null for multi-level subdomains", () => {
    expect(extractTenantSlugFromHost("a.b.yourschoolsaas.com", "yourschoolsaas.com")).toBeNull();
  });

  it("returns null when host or appDomain is missing", () => {
    expect(extractTenantSlugFromHost(null, "yourschoolsaas.com")).toBeNull();
    expect(extractTenantSlugFromHost(undefined, "yourschoolsaas.com")).toBeNull();
    expect(extractTenantSlugFromHost("alpha-school.yourschoolsaas.com", "")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(extractTenantSlugFromHost("Alpha-School.YourSchoolSaas.com", "yourschoolsaas.com")).toBe(
      "alpha-school",
    );
  });
});

describe("buildTenantLoginUrl", () => {
  it("builds an https login URL by default", () => {
    expect(buildTenantLoginUrl("alpha-school", "yourschoolsaas.com")).toBe(
      "https://alpha-school.yourschoolsaas.com/login",
    );
  });

  it("supports http for local dev", () => {
    expect(buildTenantLoginUrl("alpha-school", "localhost:3000", "http")).toBe(
      "http://alpha-school.localhost:3000/login",
    );
  });
});
