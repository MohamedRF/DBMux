import type { CatalogKind } from "../adapter.js";
export const oracleCatalog: Record<CatalogKind, string> = {
  constraintColumns: `SELECT owner AS "schema",table_name AS "table_name",constraint_name AS "name",column_name AS "column_name",position AS "position" FROM all_cons_columns`,
  indexColumns: `SELECT index_owner AS "schema",table_name AS "table_name",index_name AS "name",column_name AS "column_name",column_position AS "position",descend AS "direction" FROM all_ind_columns`,
  materializedViews: `SELECT owner AS "schema",mview_name AS "name",'MATERIALIZED VIEW' AS "kind",query AS "definition",refresh_mode AS "refresh_mode",refresh_method AS "refresh_method" FROM all_mviews`,

  schemas: `SELECT DISTINCT owner AS "schema" FROM all_objects`,
  tables: `SELECT owner AS "schema",table_name AS "name",temporary AS "temporary" FROM all_tables`,
  columns: `SELECT owner AS "schema",table_name AS "name",column_name AS "column_name",column_id AS "ordinal_position",data_type AS "data_type",data_length AS "data_length",char_length AS "char_length",char_used AS "char_used",data_precision AS "numeric_precision",data_scale AS "numeric_scale",nullable AS "is_nullable",data_default AS "column_default",identity_column AS "is_identity",virtual_column AS "is_generated" FROM all_tab_columns`,
  views: `SELECT owner AS "schema",view_name AS "name",text AS "definition" FROM all_views`,
  indexes: `SELECT owner AS "schema",table_name AS "table_name",index_name AS "name",index_type AS "kind",uniqueness AS "uniqueness" FROM all_indexes`,
  constraints: `SELECT c.owner AS "schema",c.table_name AS "table_name",c.constraint_name AS "name",c.constraint_type AS "kind",c.r_owner AS "reference_schema",c.r_constraint_name AS "reference_constraint",c.delete_rule AS "delete_rule",c.status AS "status",c.search_condition AS "condition" FROM all_constraints c`,
  sequences: `SELECT sequence_owner AS "schema",sequence_name AS "name",min_value AS "min_value",max_value AS "max_value",increment_by AS "increment_by",cycle_flag AS "cycle",cache_size AS "cache_size" FROM all_sequences`,
  triggers: `SELECT owner AS "schema",table_name AS "table_name",trigger_name AS "name",trigger_type AS "kind",triggering_event AS "event",status AS "status",trigger_body AS "definition" FROM all_triggers`,
  routines: `SELECT owner AS "schema",object_name AS "name",object_type AS "kind",status AS "status" FROM all_objects WHERE object_type IN ('PROCEDURE','FUNCTION','PACKAGE','PACKAGE BODY','TYPE','TYPE BODY')`,
  source: `SELECT owner AS "schema",name AS "name",type AS "kind",line AS "line",text AS "definition" FROM all_source`,
  dependencies: `SELECT referenced_owner AS "schema",referenced_name AS "name",owner AS "dependent_schema",name AS "dependent_name",type AS "kind" FROM all_dependencies`,
  objects: `SELECT owner AS "schema",object_name AS "name",object_type AS "kind",status AS "status" FROM all_objects WHERE subobject_name IS NULL`,
  synonyms: `SELECT owner AS "schema",synonym_name AS "name",table_owner AS "target_schema",table_name AS "target_name",db_link AS "database_link" FROM all_synonyms`,
  enums: `SELECT NULL AS "schema",NULL AS "name" FROM dual WHERE 1=0`,
  extensions: `SELECT NULL AS "schema",NULL AS "name" FROM dual WHERE 1=0`,
};
