-- Restaurant-level network printer configuration for auto-print (KOT / BOT /
-- bill).
--
-- Until now the printer a station prints to was chosen per-device and kept in
-- the browser's localStorage (see src/lib/stores/printerSettings.ts) — correct
-- for a USB printer physically wired to one till. A LAN printer, however, has a
-- stable IP reachable from every device on the restaurant's network, so it
-- belongs to the restaurant, not to one screen: configure the IP once here and
-- every kitchen tab can auto-print to it.
--
-- The app is cloud-hosted (Vercel) and cannot reach a private 192.168.x.x
-- printer, so printing still happens client-side through QZ Tray running on a
-- machine inside the restaurant's LAN — this table only stores *which* printer
-- (host:port + role); QZ Tray opens the actual socket. Kitchen/waiter/cashier
-- staff therefore need SELECT so their screen can resolve the target; only a
-- manager (or super_admin) may add/edit printers.

CREATE TABLE IF NOT EXISTS "public"."printers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "restaurant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "printer_type" "text" DEFAULT 'network'::"text" NOT NULL,
    "ip_address" "text",
    "port" integer DEFAULT 9100 NOT NULL,
    "role" "text" NOT NULL,
    "paper_width" "text" DEFAULT '80mm'::"text" NOT NULL,
    "copies" integer DEFAULT 1 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "printers_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120))),
    CONSTRAINT "printers_printer_type_check" CHECK (("printer_type" = ANY (ARRAY['network'::"text", 'usb'::"text"]))),
    CONSTRAINT "printers_role_check" CHECK (("role" = ANY (ARRAY['kot'::"text", 'bot'::"text", 'bill'::"text"]))),
    CONSTRAINT "printers_paper_width_check" CHECK (("paper_width" = ANY (ARRAY['58mm'::"text", '80mm'::"text"]))),
    CONSTRAINT "printers_port_check" CHECK ((("port" >= 1) AND ("port" <= 65535))),
    CONSTRAINT "printers_copies_check" CHECK ((("copies" >= 1) AND ("copies" <= 9))),
    -- A network printer is useless without somewhere to send bytes.
    CONSTRAINT "printers_network_requires_ip" CHECK ((("printer_type" <> 'network'::"text") OR ("ip_address" IS NOT NULL)))
);


ALTER TABLE "public"."printers" OWNER TO "postgres";


ALTER TABLE ONLY "public"."printers"
    ADD CONSTRAINT "printers_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."printers"
    ADD CONSTRAINT "printers_unique_name" UNIQUE ("restaurant_id", "name");


ALTER TABLE ONLY "public"."printers"
    ADD CONSTRAINT "printers_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurants"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."printers"
    ADD CONSTRAINT "printers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;


-- One default per (restaurant, role) at most — the auto-print resolver picks the
-- default when several printers share a role. Partial unique index so multiple
-- non-default printers are fine.
CREATE UNIQUE INDEX IF NOT EXISTS "printers_one_default_per_role"
    ON "public"."printers" ("restaurant_id", "role")
    WHERE ("is_default" IS TRUE);


CREATE INDEX IF NOT EXISTS "printers_restaurant_role_idx"
    ON "public"."printers" ("restaurant_id", "role")
    WHERE ("is_active" IS TRUE);


ALTER TABLE "public"."printers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_manage_printers" ON "public"."printers"
    USING ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())))
    WITH CHECK ((("public"."current_app_role"() = ANY (ARRAY['manager'::"text", 'super_admin'::"text"])) AND ("restaurant_id" = "public"."current_restaurant_id"())));


CREATE POLICY "staff_read_printers" ON "public"."printers"
    FOR SELECT USING (("restaurant_id" = "public"."current_restaurant_id"()));


GRANT ALL ON TABLE "public"."printers" TO "anon";
GRANT ALL ON TABLE "public"."printers" TO "authenticated";
GRANT ALL ON TABLE "public"."printers" TO "service_role";
