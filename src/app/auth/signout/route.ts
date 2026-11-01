import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_BUSINESS_COOKIE } from "@/modules/tenancy/session";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  response.cookies.delete(ACTIVE_BUSINESS_COOKIE);
  return response;
}
