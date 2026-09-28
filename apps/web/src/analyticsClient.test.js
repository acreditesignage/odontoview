import test from "node:test";
import assert from "node:assert/strict";
import {buildAnalyticsPayload,sanitizeReferrer} from "./analyticsClient.js";
import {adminEntryRedirect} from "./adminRouting.js";

test("analytics payload keeps route clean and only extracts known UTM values",()=>{
  const payload=buildAnalyticsPayload({
    sessionKey:"11111111-2222-4333-8444-555555555555",
    type:"PAGE_VIEW",
    pathname:"/acesso-exame",
    search:"?token=secret-patient-token&utm_source=instagram&utm_medium=social&utm_campaign=implantes&patient=Maria",
    referrer:"https://odontoview.example/convite-dentista?token=another-secret#fragment"
  });
  assert.equal(payload.route,"/acesso-exame");
  assert.equal(payload.utmSource,"instagram");
  assert.equal(payload.utmMedium,"social");
  assert.equal(payload.utmCampaign,"implantes");
  assert.equal(payload.referrer,"https://odontoview.example/convite-dentista");
  assert.equal(JSON.stringify(payload).includes("secret-patient-token"),false);
  assert.equal(JSON.stringify(payload).includes("another-secret"),false);
  assert.equal(JSON.stringify(payload).includes("Maria"),false);
});

test("sanitizeReferrer strips query and fragment but preserves origin and path",()=>{
  assert.equal(sanitizeReferrer("https://google.com/search?q=odontoview#top"),"https://google.com/search");
  assert.equal(sanitizeReferrer("not a valid url"),null);
});

test("admin route guard redirects ADMIN away from dentist and blocks non-admin admin route",()=>{
  assert.equal(adminEntryRedirect("/dentista","ADMIN"),"/admin");
  assert.equal(adminEntryRedirect("/admin","DENTIST"),"/");
  assert.equal(adminEntryRedirect("/admin","UNIT_USER"),"/");
  assert.equal(adminEntryRedirect("/admin","ADMIN"),null);
  assert.equal(adminEntryRedirect("/viewer2","ADMIN"),null);
});
