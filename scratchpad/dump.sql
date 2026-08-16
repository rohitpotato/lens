--
-- PostgreSQL database dump
--

\restrict u00M9Mps0ezaKa5Xw8rNdazl6LxC2Z44GfekVl5rP1wWRsDoPVLorkfvKscpWry

-- Dumped from database version 16.14
-- Dumped by pg_dump version 16.14

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: lens
--

CREATE SCHEMA drizzle;


ALTER SCHEMA drizzle OWNER TO lens;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: lens
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


ALTER TABLE drizzle.__drizzle_migrations OWNER TO lens;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: lens
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNER TO lens;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: lens
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: corrections; Type: TABLE; Schema: public; Owner: lens
--

CREATE TABLE public.corrections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    extraction_id uuid NOT NULL,
    field_path text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    correction_type text NOT NULL,
    note text,
    corrected_by text NOT NULL,
    became_fixture boolean DEFAULT false NOT NULL,
    fixture_id text,
    corrected_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.corrections OWNER TO lens;

--
-- Name: documents; Type: TABLE; Schema: public; Owner: lens
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    filename text NOT NULL,
    mime_type text NOT NULL,
    storage_path text NOT NULL,
    file_hash text NOT NULL,
    page_count integer,
    detected_type text,
    detected_type_confidence numeric,
    status text DEFAULT 'uploaded'::text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.documents OWNER TO lens;

--
-- Name: entities; Type: TABLE; Schema: public; Owner: lens
--

CREATE TABLE public.entities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    canonical_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.entities OWNER TO lens;

--
-- Name: entity_mentions; Type: TABLE; Schema: public; Owner: lens
--

CREATE TABLE public.entity_mentions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_id uuid NOT NULL,
    extraction_id uuid NOT NULL,
    field_path text NOT NULL,
    raw_value text NOT NULL,
    confidence numeric NOT NULL,
    resolved_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.entity_mentions OWNER TO lens;

--
-- Name: eval_run_artifacts; Type: TABLE; Schema: public; Owner: lens
--

CREATE TABLE public.eval_run_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    eval_run_id uuid NOT NULL,
    artifact_type text NOT NULL,
    artifact_name text NOT NULL,
    version integer NOT NULL
);


ALTER TABLE public.eval_run_artifacts OWNER TO lens;

--
-- Name: eval_runs; Type: TABLE; Schema: public; Owner: lens
--

CREATE TABLE public.eval_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fixtures_total integer NOT NULL,
    fixtures_passed integer NOT NULL,
    overall_f1 numeric,
    regressions jsonb,
    improvements jsonb,
    cost_usd numeric,
    report_markdown text,
    triggered_by text,
    ran_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.eval_runs OWNER TO lens;

--
-- Name: events; Type: TABLE; Schema: public; Owner: lens
--

CREATE TABLE public.events (
    id bigint NOT NULL,
    event_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    payload jsonb NOT NULL,
    trace_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.events OWNER TO lens;

--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: lens
--

CREATE SEQUENCE public.events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.events_id_seq OWNER TO lens;

--
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lens
--

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;


--
-- Name: extractions; Type: TABLE; Schema: public; Owner: lens
--

CREATE TABLE public.extractions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    schema_id uuid NOT NULL,
    prompt_id uuid NOT NULL,
    extracted_json jsonb NOT NULL,
    per_field_confidence jsonb NOT NULL,
    overall_confidence numeric NOT NULL,
    validation_results jsonb NOT NULL,
    model_used text NOT NULL,
    tokens_input integer,
    tokens_output integer,
    cost_usd numeric,
    latency_ms integer,
    status text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    extracted_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.extractions OWNER TO lens;

--
-- Name: pipeline_steps_completed; Type: TABLE; Schema: public; Owner: lens
--

CREATE TABLE public.pipeline_steps_completed (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_id uuid NOT NULL,
    step_name text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.pipeline_steps_completed OWNER TO lens;

--
-- Name: prompt_hints; Type: TABLE; Schema: public; Owner: lens
--

CREATE TABLE public.prompt_hints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    document_type text NOT NULL,
    matching_key text NOT NULL,
    field_path text NOT NULL,
    hint text NOT NULL,
    created_from_correction_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'suggested'::text NOT NULL,
    evidence_count integer DEFAULT 1 NOT NULL,
    note text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.prompt_hints OWNER TO lens;

--
-- Name: prompts; Type: TABLE; Schema: public; Owner: lens
--

CREATE TABLE public.prompts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    version integer NOT NULL,
    content text NOT NULL,
    model text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.prompts OWNER TO lens;

--
-- Name: schemas; Type: TABLE; Schema: public; Owner: lens
--

CREATE TABLE public.schemas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    version integer NOT NULL,
    yaml_definition text NOT NULL,
    compiled_json jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.schemas OWNER TO lens;

--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: lens
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: events id; Type: DEFAULT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);


--
-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: drizzle; Owner: lens
--

COPY drizzle.__drizzle_migrations (id, hash, created_at) FROM stdin;
1	79b8dea853f6f6733bc1dc3c6a3d4e5afaa37716dcdf1b6b1f0b194a1448905e	1786569879577
2	1ee3897e0de9d3720ec94a627c7c90ab789c1e9195b43e891ebac3ebfe105a63	1786661105093
\.


--
-- Data for Name: corrections; Type: TABLE DATA; Schema: public; Owner: lens
--

COPY public.corrections (id, extraction_id, field_path, old_value, new_value, correction_type, note, corrected_by, became_fixture, fixture_id, corrected_at) FROM stdin;
cd7b41af-9bc7-4f84-91d8-845f977b6468	bf122bd9-28e9-4959-a899-c0cad27f173e	total	4585.49	4759.2	edit	\N	reviewer	f	\N	2026-08-13 22:40:00.575357+00
b9118323-12d6-48be-9c50-ea8b639a6f9b	bf122bd9-28e9-4959-a899-c0cad27f173e	total	4759.2	4585.49	edit	correct post-credit total; sum of line_items includes negative credit rows	reviewer	f	\N	2026-08-13 22:50:02.846171+00
\.


--
-- Data for Name: documents; Type: TABLE DATA; Schema: public; Owner: lens
--

COPY public.documents (id, filename, mime_type, storage_path, file_hash, page_count, detected_type, detected_type_confidence, status, uploaded_at) FROM stdin;
268f29c4-ef59-405b-af52-0ff1dc16d422	sample.pdf	application/pdf	documents/2026/08/2b0d431e64073aca8c010ad3e2826b382d75dd3590545cc875105bf1466dca07.pdf	2b0d431e64073aca8c010ad3e2826b382d75dd3590545cc875105bf1466dca07	\N	\N	\N	uploaded	2026-08-12 21:51:15.756112+00
ee5122ef-b32c-430e-bb8e-375d4185b7e3	sample2.pdf	application/pdf	documents/2026/08/d5558cd419c8d46bdc958064cb97f963d1ea793866414c025906ec15033512ed.pdf	d5558cd419c8d46bdc958064cb97f963d1ea793866414c025906ec15033512ed	\N	\N	\N	uploaded	2026-08-12 22:06:32.309968+00
1af68969-9aa9-4049-bb5e-88d1ecf66403	sample3.pdf	application/pdf	documents/2026/08/034a259619def9ed6fb76175a5c9eab08bf96ef74271e74785ee964584b9201e.pdf	034a259619def9ed6fb76175a5c9eab08bf96ef74271e74785ee964584b9201e	\N	\N	\N	uploaded	2026-08-12 22:12:18.421755+00
869b83cb-5d58-4661-bfd0-0245e713391d	sample4.pdf	application/pdf	documents/2026/08/a243fb2cbb663e593b496cf9e86bfe5b50e749d235a19530b62a41e50f68cbe5.pdf	a243fb2cbb663e593b496cf9e86bfe5b50e749d235a19530b62a41e50f68cbe5	\N	invoice	0.95	pending_review	2026-08-12 22:16:05.602931+00
0e97daab-801d-4365-bc08-a0b2d02130b7	sample_pm2.pdf	application/pdf	documents/2026/08/41a66500b53bfb923b57d73153a4b5608eb778e05f84a03b84d6894305285cad.pdf	41a66500b53bfb923b57d73153a4b5608eb778e05f84a03b84d6894305285cad	\N	invoice	0.95	pending_review	2026-08-13 22:52:44.867653+00
4a0c1489-8d85-4afb-8fdf-cc161f6989e6	invoice-0-4.pdf	application/pdf	documents/2026/08/69cbdcd6380592c6b1ce19b5422119f1cf9ac4722edafa20fe11d642fb63d346.pdf	69cbdcd6380592c6b1ce19b5422119f1cf9ac4722edafa20fe11d642fb63d346	\N	invoice	0.99	approved	2026-08-13 23:19:30.161898+00
\.


--
-- Data for Name: entities; Type: TABLE DATA; Schema: public; Owner: lens
--

COPY public.entities (id, entity_type, canonical_name, created_at) FROM stdin;
\.


--
-- Data for Name: entity_mentions; Type: TABLE DATA; Schema: public; Owner: lens
--

COPY public.entity_mentions (id, entity_id, extraction_id, field_path, raw_value, confidence, resolved_at) FROM stdin;
\.


--
-- Data for Name: eval_run_artifacts; Type: TABLE DATA; Schema: public; Owner: lens
--

COPY public.eval_run_artifacts (id, eval_run_id, artifact_type, artifact_name, version) FROM stdin;
\.


--
-- Data for Name: eval_runs; Type: TABLE DATA; Schema: public; Owner: lens
--

COPY public.eval_runs (id, fixtures_total, fixtures_passed, overall_f1, regressions, improvements, cost_usd, report_markdown, triggered_by, ran_at) FROM stdin;
\.


--
-- Data for Name: events; Type: TABLE DATA; Schema: public; Owner: lens
--

COPY public.events (id, event_type, aggregate_type, aggregate_id, payload, trace_id, created_at) FROM stdin;
1	document.uploaded	document	268f29c4-ef59-405b-af52-0ff1dc16d422	{"filename": "sample.pdf", "sizeBytes": 41739, "storagePath": "documents/2026/08/2b0d431e64073aca8c010ad3e2826b382d75dd3590545cc875105bf1466dca07.pdf"}	\N	2026-08-12 21:51:15.756112+00
2	document.uploaded	document	ee5122ef-b32c-430e-bb8e-375d4185b7e3	{"filename": "sample2.pdf", "sizeBytes": 14, "storagePath": "documents/2026/08/d5558cd419c8d46bdc958064cb97f963d1ea793866414c025906ec15033512ed.pdf"}	\N	2026-08-12 22:06:32.309968+00
3	document.uploaded	document	1af68969-9aa9-4049-bb5e-88d1ecf66403	{"filename": "sample3.pdf", "sizeBytes": 42239, "storagePath": "documents/2026/08/034a259619def9ed6fb76175a5c9eab08bf96ef74271e74785ee964584b9201e.pdf"}	\N	2026-08-12 22:12:18.421755+00
4	document.uploaded	document	869b83cb-5d58-4661-bfd0-0245e713391d	{"filename": "sample4.pdf", "sizeBytes": 42539, "storagePath": "documents/2026/08/a243fb2cbb663e593b496cf9e86bfe5b50e749d235a19530b62a41e50f68cbe5.pdf"}	\N	2026-08-12 22:16:05.602931+00
5	document.classified	document	869b83cb-5d58-4661-bfd0-0245e713391d	{"type": "invoice", "model": "claude-haiku-4-5-20251001", "costUsd": 0.001124, "latencyMs": 1030, "confidence": 0.95}	\N	2026-08-12 22:28:02.769208+00
6	extraction.completed	extraction	bf122bd9-28e9-4959-a899-c0cad27f173e	{"status": "pending_review", "costUsd": 0.019335, "latencyMs": 9492, "documentId": "869b83cb-5d58-4661-bfd0-0245e713391d", "overallConfidence": 0.7727272727272726}	\N	2026-08-12 22:28:13.30782+00
7	correction.applied	extraction	bf122bd9-28e9-4959-a899-c0cad27f173e	{"note": null, "newValue": 4759.2, "oldValue": 4585.49, "fieldPath": "total", "documentId": "869b83cb-5d58-4661-bfd0-0245e713391d"}	\N	2026-08-13 22:40:00.575357+00
8	correction.applied	extraction	bf122bd9-28e9-4959-a899-c0cad27f173e	{"note": "correct post-credit total; sum of line_items includes negative credit rows", "newValue": 4585.49, "oldValue": 4759.2, "fieldPath": "total", "documentId": "869b83cb-5d58-4661-bfd0-0245e713391d"}	\N	2026-08-13 22:50:02.846171+00
9	document.uploaded	document	0e97daab-801d-4365-bc08-a0b2d02130b7	{"filename": "sample_pm2.pdf", "sizeBytes": 42639, "storagePath": "documents/2026/08/41a66500b53bfb923b57d73153a4b5608eb778e05f84a03b84d6894305285cad.pdf"}	\N	2026-08-13 22:52:44.867653+00
10	document.classified	document	0e97daab-801d-4365-bc08-a0b2d02130b7	{"type": "invoice", "model": "claude-haiku-4-5-20251001", "costUsd": 0.001124, "latencyMs": 1062, "confidence": 0.95}	\N	2026-08-13 22:52:47.071223+00
11	extraction.completed	extraction	00f5ad04-1f40-4388-85bf-90aa920e4205	{"status": "pending_review", "costUsd": 0.022143, "latencyMs": 6242, "documentId": "0e97daab-801d-4365-bc08-a0b2d02130b7", "hintsApplied": ["For total, sum all line items including negative credit rows rather than using a pre-calculated total that may exclude credits."], "overallConfidence": 0.7727272727272726}	\N	2026-08-13 22:53:17.909673+00
12	document.uploaded	document	4a0c1489-8d85-4afb-8fdf-cc161f6989e6	{"filename": "invoice-0-4.pdf", "sizeBytes": 67737, "storagePath": "documents/2026/08/69cbdcd6380592c6b1ce19b5422119f1cf9ac4722edafa20fe11d642fb63d346.pdf"}	\N	2026-08-13 23:19:30.161898+00
13	document.classified	document	4a0c1489-8d85-4afb-8fdf-cc161f6989e6	{"type": "invoice", "model": "claude-haiku-4-5-20251001", "costUsd": 0.001631, "latencyMs": 1699, "confidence": 0.99}	\N	2026-08-13 23:19:31.923722+00
14	extraction.completed	extraction	06f440c8-81ac-40e9-993a-de94ea84501a	{"status": "pending_review", "costUsd": 0.043203, "latencyMs": 25190, "documentId": "4a0c1489-8d85-4afb-8fdf-cc161f6989e6", "hintsApplied": [], "overallConfidence": 0.7727272727272726}	\N	2026-08-13 23:19:58.507642+00
15	review.approved	extraction	06f440c8-81ac-40e9-993a-de94ea84501a	{"documentId": "4a0c1489-8d85-4afb-8fdf-cc161f6989e6"}	\N	2026-08-13 23:23:12.331966+00
\.


--
-- Data for Name: extractions; Type: TABLE DATA; Schema: public; Owner: lens
--

COPY public.extractions (id, document_id, schema_id, prompt_id, extracted_json, per_field_confidence, overall_confidence, validation_results, model_used, tokens_input, tokens_output, cost_usd, latency_ms, status, version, reviewed_by, reviewed_at, extracted_at, updated_at) FROM stdin;
bf122bd9-28e9-4959-a899-c0cad27f173e	869b83cb-5d58-4661-bfd0-0245e713391d	21c48857-33d7-4af8-8e22-3888cfb00385	ef64306f-8740-4949-b148-5fcdcf1fcb43	{"name": "invoice", "total": 4585.49, "currency": "USD", "due_date": "2002-01-02", "subtotal": 4759.2, "line_items": [{"amount": 3172.8, "quantity": 24000, "unit_price": 132.2, "description": "MARL FF REG LS HP 6M PROM"}, {"amount": -1269.12, "quantity": null, "unit_price": null, "description": "Less Comp Cigs (MARL FF REG LS HP 6M PROM)"}, {"amount": 3172.8, "quantity": 24000, "unit_price": 132.2, "description": "MARL LT REG KS HP 6M PROM"}, {"amount": -1269.12, "quantity": null, "unit_price": null, "description": "Less Comp Cigs (MARL LT REG KS HP 6M PROM)"}, {"amount": 793.2, "quantity": 6000, "unit_price": 132.2, "description": "MARL LT REG 100 HP 6M PROM"}, {"amount": -317.28, "quantity": null, "unit_price": null, "description": "Less Comp Cigs (MARL LT REG 100 HP 6M PROM)"}, {"amount": 793.2, "quantity": 6000, "unit_price": 132.2, "description": "MARL UL REG KS HP 6M PROM"}, {"amount": -317.28, "quantity": null, "unit_price": null, "description": "Less Comp Cigs (MARL UL REG KS HP 6M PROM)"}], "tax_amount": null, "vendor_name": "Philip Morris Incorporated", "invoice_date": "2002-01-02", "invoice_number": "99999999", "vendor_address": null}	{"total": {"score": 0.9019607843137254, "signals": {"typeMatch": 1, "rulesPassed": 0.6666666666666666, "requiredPresent": 1}}, "currency": {"score": 1, "signals": {"typeMatch": 1}}, "due_date": {"score": 1, "signals": {"typeMatch": 1, "rulesPassed": 1}}, "subtotal": {"score": 0.7727272727272726, "signals": {"typeMatch": 1, "rulesPassed": 0.5}}, "line_items": {"score": 1, "signals": {"typeMatch": 1, "rulesPassed": 1}}, "tax_amount": {"score": 1, "signals": {"typeMatch": 1}}, "vendor_name": {"score": 1, "signals": {"typeMatch": 1, "requiredPresent": 1}}, "invoice_date": {"score": 1, "signals": {"typeMatch": 1, "rulesPassed": 1, "requiredPresent": 1}}, "invoice_number": {"score": 1, "signals": {"typeMatch": 1, "patternMatch": 1, "requiredPresent": 1}}, "vendor_address": {"score": 1, "signals": {"typeMatch": 1}}}	0.7727272727272726	[{"name": "line_items_sum_to_subtotal", "passed": true, "message": "Line-item amounts sum to a value different from the extracted subtotal.", "severity": "warning"}, {"name": "subtotal_plus_tax_equals_total", "passed": false, "message": "Subtotal + tax does not equal total.", "severity": "warning", "suggestsField": "total", "suggestsValue": 4759.2}, {"name": "due_date_after_invoice_date", "passed": true, "message": "Due date is before invoice date.", "severity": "error"}, {"name": "total_is_positive", "passed": true, "message": "Total must be positive.", "severity": "error"}]	claude-sonnet-4-6	3385	612	0.019335	9492	pending_review	3	\N	\N	2026-08-12 22:28:13.30782+00	2026-08-13 22:50:02.85+00
00f5ad04-1f40-4388-85bf-90aa920e4205	0e97daab-801d-4365-bc08-a0b2d02130b7	21c48857-33d7-4af8-8e22-3888cfb00385	ef64306f-8740-4949-b148-5fcdcf1fcb43	{"total": 4585.49, "currency": "USD", "due_date": "2002-01-02", "subtotal": 4759.2, "line_items": [{"amount": 3172.8, "quantity": 24000, "unit_price": 132.2, "description": "MARL FF REG LS HP 6M PROM 6M"}, {"amount": -1269.12, "quantity": null, "unit_price": null, "description": "Less Comp Cigs (MARL FF REG LS)"}, {"amount": 3172.8, "quantity": 24000, "unit_price": 132.2, "description": "MARL LT REG KS HP 6M PROM 6M"}, {"amount": -1269.12, "quantity": null, "unit_price": null, "description": "Less Comp Cigs (MARL LT REG KS)"}, {"amount": 793.2, "quantity": 6000, "unit_price": 132.2, "description": "MARL LT REG 100 HP 6M PROM 6M"}, {"amount": -317.28, "quantity": null, "unit_price": null, "description": "Less Comp Cigs (MARL LT REG 100)"}, {"amount": 793.2, "quantity": 6000, "unit_price": 132.2, "description": "MARL UL REG KS HP 6M PROM 6M"}, {"amount": -317.28, "quantity": null, "unit_price": null, "description": "Less Comp Cigs (MARL UL REG KS)"}], "tax_amount": null, "vendor_name": "Philip Morris Incorporated", "invoice_date": "2002-01-02", "invoice_number": "99999999", "vendor_address": null}	{"total": {"score": 0.9019607843137254, "signals": {"typeMatch": 1, "rulesPassed": 0.6666666666666666, "requiredPresent": 1}}, "currency": {"score": 1, "signals": {"typeMatch": 1}}, "due_date": {"score": 1, "signals": {"typeMatch": 1, "rulesPassed": 1}}, "subtotal": {"score": 0.7727272727272726, "signals": {"typeMatch": 1, "rulesPassed": 0.5}}, "line_items": {"score": 1, "signals": {"typeMatch": 1, "rulesPassed": 1}}, "tax_amount": {"score": 1, "signals": {"typeMatch": 1}}, "vendor_name": {"score": 1, "signals": {"typeMatch": 1, "requiredPresent": 1}}, "invoice_date": {"score": 1, "signals": {"typeMatch": 1, "rulesPassed": 1, "requiredPresent": 1}}, "invoice_number": {"score": 1, "signals": {"typeMatch": 1, "patternMatch": 1, "requiredPresent": 1}}, "vendor_address": {"score": 1, "signals": {"typeMatch": 1}}}	0.7727272727272726	[{"name": "line_items_sum_to_subtotal", "passed": true, "message": "Line-item amounts sum to a value different from the extracted subtotal.", "severity": "warning"}, {"name": "subtotal_plus_tax_equals_total", "passed": false, "message": "Subtotal + tax does not equal total.", "severity": "warning", "suggestsField": "total", "suggestsValue": 4759.2}, {"name": "due_date_after_invoice_date", "passed": true, "message": "Due date is before invoice date.", "severity": "error"}, {"name": "total_is_positive", "passed": true, "message": "Total must be positive.", "severity": "error"}]	claude-sonnet-4-6	4446	587	0.022143	6242	pending_review	1	\N	\N	2026-08-13 22:53:17.909673+00	2026-08-13 22:53:17.909673+00
06f440c8-81ac-40e9-993a-de94ea84501a	4a0c1489-8d85-4afb-8fdf-cc161f6989e6	21c48857-33d7-4af8-8e22-3888cfb00385	ef64306f-8740-4949-b148-5fcdcf1fcb43	{"total": 6610.95, "currency": "EUR", "due_date": null, "subtotal": 5964.5, "line_items": [{"amount": 124.5, "quantity": 10, "unit_price": 12.45, "description": "Dextromethorphan polistirex (BPXPN-00057)"}, {"amount": 400, "quantity": 25, "unit_price": 16, "description": "Venlafaxine Hydrochloride (BPXPN-00012)"}, {"amount": 249.75, "quantity": 25, "unit_price": 9.99, "description": "Metoclopramide Hydrochloride (BPXPN-00002)"}, {"amount": 44.5, "quantity": 10, "unit_price": 4.45, "description": "Avobenzone, octinoxate (BPXPN-00027)"}, {"amount": 78.9, "quantity": 10, "unit_price": 7.89, "description": "Verapamil hydrochloride (BPXPN-00066)"}, {"amount": 153.75, "quantity": 15, "unit_price": 10.25, "description": "Tiagabine hydrochloride (BPXPN-00017)"}, {"amount": 349.9, "quantity": 10, "unit_price": 34.99, "description": "Ziprasidone hydrochloride (BPXPN-00044)"}, {"amount": 349.9, "quantity": 10, "unit_price": 34.99, "description": "Risperidone (BPXPN-00023)"}, {"amount": 349.9, "quantity": 10, "unit_price": 34.99, "description": "Metoprolol succinate (BPXPN-00067)"}, {"amount": 349.9, "quantity": 10, "unit_price": 34.99, "description": "Acetaminophen (BPXPN-00045)"}, {"amount": 240, "quantity": 15, "unit_price": 16, "description": "Sorafenib (BPXPN-00018)"}, {"amount": 149.85, "quantity": 15, "unit_price": 9.99, "description": "Telmisartan (BPXPN-00022)"}, {"amount": 66.75, "quantity": 15, "unit_price": 4.45, "description": "Famotidine (BPXPN-00068)"}, {"amount": 118.35, "quantity": 15, "unit_price": 7.89, "description": "Methylphenidate Hydrochloride (BPXPN-00005)"}, {"amount": 99, "quantity": 100, "unit_price": 0.99, "description": "Ibuprofen (BPXPN-00052)"}, {"amount": 32.25, "quantity": 15, "unit_price": 2.15, "description": "Metformin Hydrochloride (BPXPN-00046)"}, {"amount": 254.85, "quantity": 15, "unit_price": 16.99, "description": "Avobenzone, Octisalate and Octocrylene (BPXPN-00069)"}, {"amount": 349.9, "quantity": 10, "unit_price": 34.99, "description": "Carisoprodol (BPXPN-00070)"}, {"amount": 349.9, "quantity": 10, "unit_price": 34.99, "description": "Losartan Potassium (BPXPN-00047)"}, {"amount": 349.9, "quantity": 10, "unit_price": 34.99, "description": "Pentazocine Hydrochloride and Naloxone Hydrochloride (BPXPN-00051)"}, {"amount": 249.75, "quantity": 25, "unit_price": 9.99, "description": "Omeprazole (BPXPN-00071)"}, {"amount": 111.25, "quantity": 25, "unit_price": 4.45, "description": "Losartan Potassium (BPXPN-00019)"}, {"amount": 78.9, "quantity": 10, "unit_price": 7.89, "description": "Saline (BPXPN-00048)"}, {"amount": 256.25, "quantity": 25, "unit_price": 10.25, "description": "Titanium dioxide (BPXPN-00021)"}, {"amount": 53.75, "quantity": 25, "unit_price": 2.15, "description": "Bicalutamide (BPXPN-00049)"}, {"amount": 254.85, "quantity": 15, "unit_price": 16.99, "description": "Ampicillin sodium (BPXPN-00050)"}, {"amount": 186.75, "quantity": 15, "unit_price": 12.45, "description": "Octinoxate, Titanium Dioxide, Octisalate (BPXPN-00004)"}, {"amount": 311.25, "quantity": 25, "unit_price": 12.45, "description": "Cavia porcellus hair and cavia porcellus skin (BPXPN-00020)"}], "tax_amount": 596.45, "vendor_name": "Bioplex", "invoice_date": "2021-05-23", "invoice_number": "BPXINV-00550", "vendor_address": "5 Rue Bader, Narbonne, Aude, 11100"}	{"total": {"score": 0.9019607843137254, "signals": {"typeMatch": 1, "rulesPassed": 0.6666666666666666, "requiredPresent": 1}}, "currency": {"score": 1, "signals": {"typeMatch": 1}}, "due_date": {"score": 1, "signals": {"typeMatch": 1, "rulesPassed": 1}}, "subtotal": {"score": 0.7727272727272726, "signals": {"typeMatch": 1, "rulesPassed": 0.5}}, "line_items": {"score": 1, "signals": {"typeMatch": 1, "rulesPassed": 1}}, "tax_amount": {"score": 1, "signals": {"typeMatch": 1}}, "vendor_name": {"score": 1, "signals": {"typeMatch": 1, "requiredPresent": 1}}, "invoice_date": {"score": 1, "signals": {"typeMatch": 1, "rulesPassed": 1, "requiredPresent": 1}}, "invoice_number": {"score": 1, "signals": {"typeMatch": 1, "patternMatch": 1, "requiredPresent": 1}}, "vendor_address": {"score": 1, "signals": {"typeMatch": 1}}}	0.7727272727272726	[{"name": "line_items_sum_to_subtotal", "passed": true, "message": "Line-item amounts sum to a value different from the extracted subtotal.", "severity": "warning"}, {"name": "subtotal_plus_tax_equals_total", "passed": false, "message": "Subtotal + tax does not equal total.", "severity": "warning", "suggestsField": "total", "suggestsValue": 6560.95}, {"name": "due_date_after_invoice_date", "passed": true, "severity": "error"}, {"name": "total_is_positive", "passed": true, "message": "Total must be positive.", "severity": "error"}]	claude-sonnet-4-6	5196	1841	0.043203	25190	approved	1	reviewer	2026-08-13 23:23:12.333+00	2026-08-13 23:19:58.507642+00	2026-08-13 23:19:58.507642+00
\.


--
-- Data for Name: pipeline_steps_completed; Type: TABLE DATA; Schema: public; Owner: lens
--

COPY public.pipeline_steps_completed (id, document_id, step_name, completed_at) FROM stdin;
2a199c39-8e91-436c-b962-f59686367e4c	869b83cb-5d58-4661-bfd0-0245e713391d	classify	2026-08-12 22:28:02.777256+00
96c81d04-c165-4eac-b85e-a088f8ac501d	869b83cb-5d58-4661-bfd0-0245e713391d	extract	2026-08-12 22:28:13.321914+00
915c7305-c4bc-4d04-bd19-d31d14ad8ab6	0e97daab-801d-4365-bc08-a0b2d02130b7	classify	2026-08-13 22:52:47.080284+00
be580656-de4b-429e-a904-cc3a00b2513d	0e97daab-801d-4365-bc08-a0b2d02130b7	extract	2026-08-13 22:53:17.924537+00
b95ceafe-a22b-4839-82b4-347d02eb43f2	4a0c1489-8d85-4afb-8fdf-cc161f6989e6	classify	2026-08-13 23:19:31.931459+00
7bbdd565-653e-4cc9-b067-4ac6afc58c02	4a0c1489-8d85-4afb-8fdf-cc161f6989e6	extract	2026-08-13 23:19:58.516032+00
\.


--
-- Data for Name: prompt_hints; Type: TABLE DATA; Schema: public; Owner: lens
--

COPY public.prompt_hints (id, document_type, matching_key, field_path, hint, created_from_correction_id, is_active, created_at, status, evidence_count, note, updated_at) FROM stdin;
4608cc18-737b-4dc7-9273-b6334a01e23b	invoice	philip morris	total	For total, sum all line items including negative credit rows rather than using a pre-calculated total that may exclude credits.	b9118323-12d6-48be-9c50-ea8b639a6f9b	t	2026-08-13 22:50:06.031868+00	adopted	2	Corrections show oscillation between 4759.2 and 4585.49, with note indicating correct total should be post-credit sum of line_items.	2026-08-13 22:52:16.369+00
\.


--
-- Data for Name: prompts; Type: TABLE DATA; Schema: public; Owner: lens
--

COPY public.prompts (id, name, version, content, model, created_at) FROM stdin;
5f10432d-264c-4ed6-883a-cd3061b193f0	classify	1	You are classifying a business document into one of the known types.\n\nTypes:\n- invoice: A bill from a vendor requesting payment, usually with invoice number, dates, line items, and a total amount owed.\n- unknown: Anything you cannot confidently identify as one of the above.\n\nRules:\n1. Return ONLY a JSON object of the shape `{ "type": "<type>", "confidence": <0..1> }`.\n2. `confidence` is your calibrated confidence that the type label is correct. If you are unsure, return `unknown` with the confidence of the second-best guess.\n3. No prose, no fences.\n\nDocument text (first pages):\n{document_text}	claude-haiku-4-5	2026-08-12 21:50:13.072716+00
ef64306f-8740-4949-b148-5fcdcf1fcb43	extract_invoice	1	You are extracting structured data from an invoice PDF. Extract every field in the schema below.\n\nRules:\n1. If a field is not present in the document, return `null`. Do NOT guess.\n2. Monetary values are numbers without currency symbols. The currency goes in the `currency` field.\n3. `total` is the final amount the recipient owes, AFTER all taxes and credits. If the document shows subtotal, tax, and grand total, `total` is the grand total.\n4. `subtotal` is the amount BEFORE tax. `tax_amount` is the total tax across all lines.\n5. For `line_items`, extract each visible row of the primary line-item table. Do NOT include subtotal, tax, or total rows.\n6. Dates in ISO 8601 format (YYYY-MM-DD). If the year is ambiguous, prefer the most recent past year.\n7. Return ONLY the JSON object matching the schema. No prose, no fences.\n\nSchema:\n{schema_json}\n\nVendor-specific extraction rules (if any):\n{prompt_hints}	claude-sonnet-4-6	2026-08-12 21:50:13.077088+00
d036ee4f-2320-4bea-8b74-949c58708091	generate_hint	1	You are analyzing corrections a human reviewer made to invoice extractions from a specific vendor, so that a future extraction of another invoice from the same vendor will get the field right on the first pass.\n\nVendor: {vendor}\nField: {field}\n\nRecent corrections on this field for this vendor:\n{corrections}\n\nProduce a single, actionable rule that would prevent the extractor from making the same mistake again. The rule will be pasted into the extractor's system prompt for future invoices from this vendor.\n\nRules:\n1. Return ONLY a JSON object of the shape `{ "hint": "<one sentence>", "note": "<one short sentence rationale, optional>" }`.\n2. `hint` must be one sentence, imperative voice, referencing the field by its schema name (e.g. "total", "tax_amount").\n3. Do NOT invent facts not supported by the corrections. If the corrections don't imply a clear rule, return `{ "hint": "", "note": "insufficient signal" }`.\n4. No prose outside the JSON, no fences.	claude-haiku-4-5	2026-08-13 22:45:37.51769+00
\.


--
-- Data for Name: schemas; Type: TABLE DATA; Schema: public; Owner: lens
--

COPY public.schemas (id, name, version, yaml_definition, compiled_json, is_active, created_at) FROM stdin;
21c48857-33d7-4af8-8e22-3888cfb00385	invoice	1	# Invoice schema — v1\n#\n# Product-friendly names for a compatible subset of DocILE.\n# Mapping notes (docile fieldtype → this schema field):\n#   vendor_name             → vendor_name\n#   sender_address          → vendor_address       (docile enum has a sender_* group)\n#   document_id             → invoice_number\n#   date_issue              → invoice_date\n#   date_due                → due_date\n#   amount_total_net        → subtotal\n#   amount_total_tax        → tax_amount\n#   amount_total_gross      → total\n#   (inferred or per-doc)   → currency\n#   line_item_description   → line_items[].description\n#   line_item_quantity      → line_items[].quantity\n#   line_item_unit_price_gross → line_items[].unit_price\n#   line_item_amount_gross  → line_items[].amount\n#\n# The 'docile' key on each field records the source fieldtype so fixture\n# import from DocILE annotations is a straight rename (see evals/README.md).\n\nname: invoice\nversion: 1\ndescription: A vendor invoice with header fields and line items.\n\nfields:\n  vendor_name:\n    type: string\n    required: true\n    docile: vendor_name\n    description: Legal name of the entity issuing the invoice.\n    normalize:\n      via: entity_resolution\n      entity_type: vendor\n\n  vendor_address:\n    type: string\n    required: false\n    docile: sender_address\n    description: Postal address of the vendor.\n\n  invoice_number:\n    type: string\n    required: true\n    docile: document_id\n    pattern: '[A-Za-z0-9\\-\\/]+'\n    description: Unique identifier for this invoice from the vendor.\n\n  invoice_date:\n    type: date\n    required: true\n    docile: date_issue\n    format: iso8601\n    description: Date the invoice was issued (YYYY-MM-DD).\n\n  due_date:\n    type: date\n    required: false\n    docile: date_due\n    format: iso8601\n    description: Date payment is due.\n\n  currency:\n    type: enum\n    values: [USD, EUR, GBP, INR, JPY, AUD, CAD]\n    default: USD\n    description: Currency code for all monetary fields on this invoice.\n\n  subtotal:\n    type: money\n    required: false\n    docile: amount_total_net\n    description: Total before tax.\n\n  tax_amount:\n    type: money\n    required: false\n    docile: amount_total_tax\n    description: Total tax across all lines.\n\n  total:\n    type: money\n    required: true\n    docile: amount_total_gross\n    description: Grand total the recipient owes, after all taxes and credits.\n\n  line_items:\n    type: list\n    required: false\n    element:\n      description:\n        type: string\n        required: true\n        docile: line_item_description\n      quantity:\n        type: number\n        required: false\n        docile: line_item_quantity\n      unit_price:\n        type: money\n        required: false\n        docile: line_item_unit_price_gross\n      amount:\n        type: money\n        required: true\n        docile: line_item_amount_gross\n\nvalidations:\n  - name: line_items_sum_to_subtotal\n    rule: 'abs(sum(line_items[*].amount) - subtotal) < 0.01'\n    severity: warning\n    applies_if: 'line_items != null && subtotal != null'\n    suggests:\n      field: subtotal\n      value: 'sum(line_items[*].amount)'\n    message: 'Line-item amounts sum to a value different from the extracted subtotal.'\n\n  - name: subtotal_plus_tax_equals_total\n    rule: 'abs((subtotal || 0) + (tax_amount || 0) - total) < 0.01'\n    severity: warning\n    applies_if: 'total != null'\n    suggests:\n      field: total\n      value: '(subtotal || 0) + (tax_amount || 0)'\n    message: 'Subtotal + tax does not equal total.'\n\n  - name: due_date_after_invoice_date\n    rule: 'due_date >= invoice_date'\n    severity: error\n    applies_if: 'due_date != null && invoice_date != null'\n    message: 'Due date is before invoice date.'\n\n  - name: total_is_positive\n    rule: 'total > 0'\n    severity: error\n    applies_if: 'total != null'\n    message: 'Total must be positive.'\n	{"name": "invoice", "fields": {"total": {"type": "money", "docile": "amount_total_gross", "required": true, "description": "Grand total the recipient owes, after all taxes and credits."}, "currency": {"type": "enum", "values": ["USD", "EUR", "GBP", "INR", "JPY", "AUD", "CAD"], "default": "USD", "description": "Currency code for all monetary fields on this invoice."}, "due_date": {"type": "date", "docile": "date_due", "format": "iso8601", "required": false, "description": "Date payment is due."}, "subtotal": {"type": "money", "docile": "amount_total_net", "required": false, "description": "Total before tax."}, "line_items": {"type": "list", "element": {"amount": {"type": "money", "docile": "line_item_amount_gross", "required": true}, "quantity": {"type": "number", "docile": "line_item_quantity", "required": false}, "unit_price": {"type": "money", "docile": "line_item_unit_price_gross", "required": false}, "description": {"type": "string", "docile": "line_item_description", "required": true}}, "required": false}, "tax_amount": {"type": "money", "docile": "amount_total_tax", "required": false, "description": "Total tax across all lines."}, "vendor_name": {"type": "string", "docile": "vendor_name", "required": true, "normalize": {"via": "entity_resolution", "entity_type": "vendor"}, "description": "Legal name of the entity issuing the invoice."}, "invoice_date": {"type": "date", "docile": "date_issue", "format": "iso8601", "required": true, "description": "Date the invoice was issued (YYYY-MM-DD)."}, "invoice_number": {"type": "string", "docile": "document_id", "pattern": "[A-Za-z0-9\\\\-\\\\/]+", "required": true, "description": "Unique identifier for this invoice from the vendor."}, "vendor_address": {"type": "string", "docile": "sender_address", "required": false, "description": "Postal address of the vendor."}}, "version": 1, "description": "A vendor invoice with header fields and line items.", "validations": [{"name": "line_items_sum_to_subtotal", "rule": "abs(sum(line_items[*].amount) - subtotal) < 0.01", "message": "Line-item amounts sum to a value different from the extracted subtotal.", "severity": "warning", "suggests": {"field": "subtotal", "value": "sum(line_items[*].amount)"}, "applies_if": "line_items != null && subtotal != null"}, {"name": "subtotal_plus_tax_equals_total", "rule": "abs((subtotal || 0) + (tax_amount || 0) - total) < 0.01", "message": "Subtotal + tax does not equal total.", "severity": "warning", "suggests": {"field": "total", "value": "(subtotal || 0) + (tax_amount || 0)"}, "applies_if": "total != null"}, {"name": "due_date_after_invoice_date", "rule": "due_date >= invoice_date", "message": "Due date is before invoice date.", "severity": "error", "applies_if": "due_date != null && invoice_date != null"}, {"name": "total_is_positive", "rule": "total > 0", "message": "Total must be positive.", "severity": "error", "applies_if": "total != null"}]}	t	2026-08-12 21:50:13.067007+00
\.


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE SET; Schema: drizzle; Owner: lens
--

SELECT pg_catalog.setval('drizzle.__drizzle_migrations_id_seq', 2, true);


--
-- Name: events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: lens
--

SELECT pg_catalog.setval('public.events_id_seq', 15, true);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: lens
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: corrections corrections_pkey; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.corrections
    ADD CONSTRAINT corrections_pkey PRIMARY KEY (id);


--
-- Name: documents documents_file_hash_uniq; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_file_hash_uniq UNIQUE (file_hash);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: entities entities_pkey; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_pkey PRIMARY KEY (id);


--
-- Name: entities entities_type_name_uniq; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.entities
    ADD CONSTRAINT entities_type_name_uniq UNIQUE (entity_type, canonical_name);


--
-- Name: entity_mentions entity_mentions_pkey; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.entity_mentions
    ADD CONSTRAINT entity_mentions_pkey PRIMARY KEY (id);


--
-- Name: eval_run_artifacts eval_run_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.eval_run_artifacts
    ADD CONSTRAINT eval_run_artifacts_pkey PRIMARY KEY (id);


--
-- Name: eval_run_artifacts eval_run_artifacts_uniq; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.eval_run_artifacts
    ADD CONSTRAINT eval_run_artifacts_uniq UNIQUE (eval_run_id, artifact_type, artifact_name);


--
-- Name: eval_runs eval_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.eval_runs
    ADD CONSTRAINT eval_runs_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: extractions extractions_pkey; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.extractions
    ADD CONSTRAINT extractions_pkey PRIMARY KEY (id);


--
-- Name: pipeline_steps_completed pipeline_steps_completed_pkey; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.pipeline_steps_completed
    ADD CONSTRAINT pipeline_steps_completed_pkey PRIMARY KEY (id);


--
-- Name: pipeline_steps_completed pipeline_steps_doc_step_uniq; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.pipeline_steps_completed
    ADD CONSTRAINT pipeline_steps_doc_step_uniq UNIQUE (document_id, step_name);


--
-- Name: prompt_hints prompt_hints_pkey; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.prompt_hints
    ADD CONSTRAINT prompt_hints_pkey PRIMARY KEY (id);


--
-- Name: prompts prompts_name_version_uniq; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_name_version_uniq UNIQUE (name, version);


--
-- Name: prompts prompts_pkey; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_pkey PRIMARY KEY (id);


--
-- Name: schemas schemas_name_version_uniq; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.schemas
    ADD CONSTRAINT schemas_name_version_uniq UNIQUE (name, version);


--
-- Name: schemas schemas_pkey; Type: CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.schemas
    ADD CONSTRAINT schemas_pkey PRIMARY KEY (id);


--
-- Name: corrections_corrected_at_idx; Type: INDEX; Schema: public; Owner: lens
--

CREATE INDEX corrections_corrected_at_idx ON public.corrections USING btree (corrected_at);


--
-- Name: corrections_extraction_field_idx; Type: INDEX; Schema: public; Owner: lens
--

CREATE INDEX corrections_extraction_field_idx ON public.corrections USING btree (extraction_id, field_path);


--
-- Name: documents_status_idx; Type: INDEX; Schema: public; Owner: lens
--

CREATE INDEX documents_status_idx ON public.documents USING btree (status);


--
-- Name: entity_mentions_extraction_idx; Type: INDEX; Schema: public; Owner: lens
--

CREATE INDEX entity_mentions_extraction_idx ON public.entity_mentions USING btree (extraction_id);


--
-- Name: eval_run_artifacts_run_idx; Type: INDEX; Schema: public; Owner: lens
--

CREATE INDEX eval_run_artifacts_run_idx ON public.eval_run_artifacts USING btree (eval_run_id);


--
-- Name: eval_runs_ran_at_idx; Type: INDEX; Schema: public; Owner: lens
--

CREATE INDEX eval_runs_ran_at_idx ON public.eval_runs USING btree (ran_at);


--
-- Name: events_aggregate_idx; Type: INDEX; Schema: public; Owner: lens
--

CREATE INDEX events_aggregate_idx ON public.events USING btree (aggregate_type, aggregate_id, created_at);


--
-- Name: events_type_idx; Type: INDEX; Schema: public; Owner: lens
--

CREATE INDEX events_type_idx ON public.events USING btree (event_type, created_at);


--
-- Name: extractions_document_id_idx; Type: INDEX; Schema: public; Owner: lens
--

CREATE INDEX extractions_document_id_idx ON public.extractions USING btree (document_id, extracted_at);


--
-- Name: extractions_status_confidence_idx; Type: INDEX; Schema: public; Owner: lens
--

CREATE INDEX extractions_status_confidence_idx ON public.extractions USING btree (status, overall_confidence);


--
-- Name: prompt_hints_lookup_idx; Type: INDEX; Schema: public; Owner: lens
--

CREATE INDEX prompt_hints_lookup_idx ON public.prompt_hints USING btree (document_type, matching_key, status);


--
-- Name: prompt_hints_status_idx; Type: INDEX; Schema: public; Owner: lens
--

CREATE INDEX prompt_hints_status_idx ON public.prompt_hints USING btree (status, created_at);


--
-- Name: corrections corrections_extraction_id_extractions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.corrections
    ADD CONSTRAINT corrections_extraction_id_extractions_id_fk FOREIGN KEY (extraction_id) REFERENCES public.extractions(id) ON DELETE CASCADE;


--
-- Name: entity_mentions entity_mentions_entity_id_entities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.entity_mentions
    ADD CONSTRAINT entity_mentions_entity_id_entities_id_fk FOREIGN KEY (entity_id) REFERENCES public.entities(id) ON DELETE CASCADE;


--
-- Name: entity_mentions entity_mentions_extraction_id_extractions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.entity_mentions
    ADD CONSTRAINT entity_mentions_extraction_id_extractions_id_fk FOREIGN KEY (extraction_id) REFERENCES public.extractions(id) ON DELETE CASCADE;


--
-- Name: eval_run_artifacts eval_run_artifacts_eval_run_id_eval_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.eval_run_artifacts
    ADD CONSTRAINT eval_run_artifacts_eval_run_id_eval_runs_id_fk FOREIGN KEY (eval_run_id) REFERENCES public.eval_runs(id) ON DELETE CASCADE;


--
-- Name: extractions extractions_document_id_documents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.extractions
    ADD CONSTRAINT extractions_document_id_documents_id_fk FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: extractions extractions_prompt_id_prompts_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.extractions
    ADD CONSTRAINT extractions_prompt_id_prompts_id_fk FOREIGN KEY (prompt_id) REFERENCES public.prompts(id);


--
-- Name: extractions extractions_schema_id_schemas_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.extractions
    ADD CONSTRAINT extractions_schema_id_schemas_id_fk FOREIGN KEY (schema_id) REFERENCES public.schemas(id);


--
-- Name: pipeline_steps_completed pipeline_steps_completed_document_id_documents_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.pipeline_steps_completed
    ADD CONSTRAINT pipeline_steps_completed_document_id_documents_id_fk FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: prompt_hints prompt_hints_created_from_correction_id_corrections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: lens
--

ALTER TABLE ONLY public.prompt_hints
    ADD CONSTRAINT prompt_hints_created_from_correction_id_corrections_id_fk FOREIGN KEY (created_from_correction_id) REFERENCES public.corrections(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict u00M9Mps0ezaKa5Xw8rNdazl6LxC2Z44GfekVl5rP1wWRsDoPVLorkfvKscpWry

