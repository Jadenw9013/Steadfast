import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveZipCode } from "@/lib/utils/zip-lookup";

describe("resolveZipCode", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns null for invalid or short zip codes without calling fetch", async () => {
    const result = await resolveZipCode("123");
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns null for zip codes containing non-digits resulting in short length", async () => {
    const result = await resolveZipCode("12a3");
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("cleans and resolves a valid zip code successfully", async () => {
    const mockResponse = {
      "post code": "90210",
      country: "United States",
      places: [
        {
          "place name": "Beverly Hills",
          "state abbreviation": "CA",
          state: "California"
        }
      ]
    };

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const result = await resolveZipCode("  90210-1234  ");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.zippopotam.us/us/90210",
      { next: { revalidate: 86400 } }
    );
    expect(result).toEqual({
      city: "Beverly Hills",
      state: "CA",
      stateName: "California",
      zip: "90210"
    });
  });

  it("returns null when fetch returns not ok (e.g. 404)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false
    });

    const result = await resolveZipCode("99999");
    expect(result).toBeNull();
  });

  it("returns null when API response places array is empty or undefined", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ "post code": "90210", country: "United States", places: [] })
    });

    const result = await resolveZipCode("90210");
    expect(result).toBeNull();
  });

  it("returns null when network error occurs (fetch throws)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network failure"));

    const result = await resolveZipCode("90210");
    expect(result).toBeNull();
  });
});
