--
-- PostgreSQL database dump
--

-- Dumped from database version 12.11 (Ubuntu 12.11-0ubuntu0.20.04.1)
-- Dumped by pg_dump version 12.11 (Ubuntu 12.11-0ubuntu0.20.04.1)

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
-- Name: rbac; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA rbac;

CREATE EXTENSION ltree WITH SCHEMA rbac ;

ALTER SCHEMA rbac OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: paths; Type: TABLE; Schema: rbac; Owner: postgres
--

CREATE TABLE rbac.paths (
    id uuid DEFAULT public.gen_random_uuid() NOT NULL,
    role integer NOT NULL,
    path rbac.ltree NOT NULL
);


ALTER TABLE rbac.paths OWNER TO postgres;

--
-- Name: roles; Type: TABLE; Schema: rbac; Owner: postgres
--

CREATE TABLE rbac.roles (
    id integer NOT NULL,
    name character varying NOT NULL,
    created_at timestamp without time zone,
    updated_at timestamp without time zone
);


ALTER TABLE rbac.roles OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: rbac; Owner: postgres
--

CREATE SEQUENCE rbac.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE rbac.roles_id_seq OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: rbac; Owner: postgres
--

ALTER SEQUENCE rbac.roles_id_seq OWNED BY rbac.roles.id;


--
-- Name: roles id; Type: DEFAULT; Schema: rbac; Owner: postgres
--

ALTER TABLE ONLY rbac.roles ALTER COLUMN id SET DEFAULT nextval('rbac.roles_id_seq'::regclass);


--
-- Name: paths paths_pkey; Type: CONSTRAINT; Schema: rbac; Owner: postgres
--

ALTER TABLE ONLY rbac.paths
    ADD CONSTRAINT paths_pkey PRIMARY KEY (id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: rbac; Owner: postgres
--

ALTER TABLE ONLY rbac.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: rbac; Owner: postgres
--

ALTER TABLE ONLY rbac.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: paths paths_role_fkey; Type: FK CONSTRAINT; Schema: rbac; Owner: postgres
--

ALTER TABLE ONLY rbac.paths
    ADD CONSTRAINT paths_role_fkey FOREIGN KEY (role) REFERENCES rbac.roles(id);


--
-- Name: SCHEMA rbac; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA rbac TO auth;


--
-- Name: TABLE paths; Type: ACL; Schema: rbac; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE rbac.paths TO auth;


--
-- Name: TABLE roles; Type: ACL; Schema: rbac; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE rbac.roles TO auth;


--
-- Name: SEQUENCE roles_id_seq; Type: ACL; Schema: rbac; Owner: postgres
--

GRANT USAGE ON SEQUENCE rbac.roles_id_seq TO auth;


--
-- PostgreSQL database dump complete
--

