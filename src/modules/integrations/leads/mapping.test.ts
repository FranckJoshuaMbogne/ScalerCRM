import { describe, expect, it } from "vitest";
import { applyMapping, fromGoogleLead, fromMetaLead, parseLeadgenWebhook } from "./mapping";

describe("field mapping", () => {
  it("uses sensible defaults and keeps the rest as notes", () => {
    expect(
      applyMapping(
        [
          { field: "full_name", value: "Lakshmi Rao" },
          { field: "phone_number", value: "+91 98220 00001" },
          { field: "email", value: "LAKSHMI@Example.com" },
          { field: "which_outfit?", value: "Saree" },
        ],
        {},
      ),
    ).toEqual({ fullName: "Lakshmi Rao", phone: "+91 98220 00001", email: "lakshmi@example.com", notes: ["which outfit?: Saree"], customFields: {} });
  });

  it("follows the form's mapping, including custom fields and ignored fields", () => {
    expect(
      applyMapping(
        [
          { field: "first_name", value: "Meena" },
          { field: "last_name", value: "Iyer" },
          { field: "wedding_date", value: "2027-02-14" },
          { field: "promo", value: "yes" },
        ],
        { wedding_date: "custom:occasion_date", promo: "ignore" },
      ),
    ).toEqual({ fullName: "Meena Iyer", phone: null, email: null, notes: [], customFields: { occasion_date: "2027-02-14" } });
  });
});

describe("Meta Lead Ads", () => {
  it("reads leadgen webhooks", () => {
    expect(
      parseLeadgenWebhook({
        object: "page",
        entry: [{ id: "1122334455", changes: [{ field: "leadgen", value: { leadgen_id: "lg-1", page_id: "1122334455", form_id: "f1", ad_id: "ad-1", created_time: 1765779000 } }] }],
      }),
    ).toEqual([{ leadgenId: "lg-1", pageId: "1122334455", formId: "f1", adId: "ad-1", createdTime: 1765779000 }]);
    expect(parseLeadgenWebhook({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
  });

  it("turns a fetched lead into answers and touch ids", () => {
    const lead = fromMetaLead({
      field_data: [{ name: "full_name", values: ["Lakshmi"] }, { name: "phone_number", values: ["+919822000001"] }],
      campaign_id: "c-1", campaign_name: "Diwali FB", adset_id: "as-1", ad_id: "ad-1", form_id: "f1", platform: "ig",
    });
    expect(lead.answers).toEqual([{ field: "full_name", value: "Lakshmi" }, { field: "phone_number", value: "+919822000001" }]);
    expect(lead.campaign).toBe("Diwali FB");
    expect(lead.touch).toEqual({ campaign_id: "c-1", adset_id: "as-1", ad_id: "ad-1", form_id: "f1", utm_source: "instagram", utm_medium: "paid_social" });
  });
});

describe("Google Ads lead forms", () => {
  it("reads columns, ids and the key", () => {
    const g = fromGoogleLead({
      lead_id: "L1", form_id: 77, campaign_id: 123, gcl_id: "gcl-abc", adgroup_id: 9, creative_id: 5, google_key: "k3y", is_test: true,
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Ravi" },
        { column_id: "PHONE_NUMBER", string_value: "+919811000001" },
        { column_id: "OTHER", column_name: "Preferred store", string_value: "Banjara Hills" },
      ],
    });
    expect(g).toMatchObject({ leadId: "L1", formId: "77", googleKey: "k3y", isTest: true });
    expect(g.touch).toEqual({ campaign_id: "123", adset_id: "9", ad_id: "5", form_id: "77", gclid: "gcl-abc", utm_source: "google", utm_medium: "cpc" });
    expect(applyMapping(g.answers, g.builtInMapping)).toMatchObject({ fullName: "Ravi", phone: "+919811000001", notes: ["Preferred store: Banjara Hills"] });
  });
});
