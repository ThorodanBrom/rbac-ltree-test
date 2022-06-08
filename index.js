const dotenv = require("dotenv");
dotenv.config({ path: "./pg.env" });
const express = require("express");
const bodyParser = require("body-parser");
const { Pool } = require("pg");
const pool = new Pool();
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
const port = 3000;

app.get("/", async (req, res) => {
  const html = await render_main_page();
  res.send(html);
});

app.post("/createRole", async (req, res) => {
  const new_role = req.body.rolename;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const query =
      "insert into roles (name, created_at, updated_at) values ($1::text, now(), now()) on conflict(name) do nothing returning id";
    const result = await client.query(query, [new_role]);
    if (result.rowCount === 0) {
      res.status(409).send("That role name already exists");
      throw new Error("Failed to create new role");
    }
    const id = result.rows[0].id;
    console.log(id);
    const path_query =
      "insert into paths (role, path) values ($1::int, $2::ltree)";
    const succ = await client.query(path_query, [id, `${id}`]);
    if (succ.rowCount === 0) {
      res.status(500).send("Failed!");
      throw new Error("Failed to create new role");
    }
    await client.query("COMMIT");
    const html = await render_main_page();
    res.send(html);
  } catch (e) {
    await client.query("ROLLBACK");

    throw e;
  } finally {
    client.release();
  }
});

app.post("/createRelation", async (req, res) => {
  console.log(req.body);
  /* Disallow if parent = child */
  const parent_role = req.body.fromRole;
  const child_role = req.body.toRole;
  if (parent_role === child_role) {
    res.status(400).send("Parent can't be same as child");
    return;
  }
  const client = await pool.connect();
  let parent_id;
  let child_id;
  let child_descends;
  let parent_paths;
  try {
    const query = "select id, name from roles where name = any($1::text[])";
    const re = await client.query(query, [[parent_role, child_role]]);
    if (re.rowCount !== 2) {
      throw new Error("Role name not found");
    }
    if (re.rows[0].name === parent_role) {
      parent_id = re.rows[0].id;
      child_id = re.rows[1].id;
    } else {
      child_id = re.rows[0].id;
      parent_id = re.rows[1].id;
    }

    const que =
      "select path from paths where path ~ $1::lquery or path ~ $2::lquery";

    const anypath = await client.query(que, [
      `*.${parent_id}.*.${child_id}.*`,
      `*.${child_id}.*.${parent_id}.*`,
    ]);
    if (anypath.rowCount !== 0) {
      throw new Error("Path exists between roles, not allowed dut to cycles");
    }
    // getting all valid paths (from root) for parent node
    const get_parent_paths = "select path from paths where path ~ $1::lquery";
    const pps = await client.query(get_parent_paths, [`*.${parent_id}`]);
    parent_paths = pps.rows.map((x) => x.path);

    const get_child_descendants =
      "SELECT distinct role, subpath(path, index(path, $1::ltree)) as subpath FROM paths WHERE path ~ $2::lquery";
    const des = await client.query(get_child_descendants, [
      child_id,
      `*.${child_id}.*{1,}`,
    ]);
    child_descends = des.rows;
  } catch (e) {
    client.release();
    res.status(400).send(e.message);
    return;
  }
  try {
    await client.query("BEGIN");
    for (let ppath of parent_paths) {
      // create new path from parent to child
      let updated_child_path = `${ppath}.${child_id}`;
      const query =
        "insert into paths (role, path) values ($1::int, $2::ltree)";
      const result = await client.query(query, [child_id, updated_child_path]);

      // for all child's descendants, add new path coming from parent
      for (let cpath of child_descends) {
        let new_path_thru_parent = `${ppath}.${cpath.subpath}`;
        const query =
          "insert into paths (role, path) values ($1::int, $2::ltree)";
        const result = await client.query(query, [
          cpath.role,
          new_path_thru_parent,
        ]);
      }
    }

    // delete all paths that previously began at child
    // should only happen if the child was previously a root node
    const dele = "delete from paths where path ~ $1::lquery";
    const fin = await client.query(dele, [`${child_id}.*`]);

    await client.query("COMMIT");
    const html = await render_main_page();
    res.send(html);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.send(e);
  } finally {
    client.release();
  }
});

app.post("/checkRoleMapping", async (req, res) => {
  console.log(req.body);
  const role_to_check = req.body.roleToCheck;
  let owned_roles_arr;
  if (typeof req.body.ownedRoles == "string")
    owned_roles_arr = [req.body.ownedRoles];
  else owned_roles_arr = req.body.ownedRoles;
  const input_roles = [...new Set(owned_roles_arr).add(role_to_check)];
  const client = await pool.connect();
  try {
    const que = "select id, name from roles where name = any($1::text[])";
    const result = await client.query(que, [input_roles]);
    console.log(result.rows);
    if (result.rows.length !== input_roles.length) {
      throw new Error("Bad roles sent");
    }

    let owned_role_ids = [];
    let checkrole_id;

    for (let role of result.rows) {
      if (owned_roles_arr.includes(role.name)) owned_role_ids.push(role.id);
      if (role.name === role_to_check) checkrole_id = role.id;
    }

    const query =
      "select $1::int in (SELECT distinct role FROM paths WHERE path ~ $2::lquery) as answer";
    const concat_owned_role_ids = owned_role_ids.join("|");

    const sa = await client.query(query, [
      checkrole_id,
      `*.${concat_owned_role_ids}.*`,
    ]);
    if (sa.rows[0].answer === false) {
      res
        .status(400)
        .send("The requested role does not map to the owned roles");
    } else {
      res.status(203).send("Roles map!");
    }
  } catch (e) {
    res.status(400).send(e.message);
  } finally {
    client.release();
  }
});

app.post("/deleteRelation", async (req, res) => {
  console.log(req.body);
  const parent_role = req.body.fromRole;
  const child_role = req.body.toRole;

  if (parent_role === child_role) {
    res.status(400).send("Parent can't be same as child");
    return;
  }
  const client = await pool.connect();
  let parent_id;
  let child_id;
  let path_ids_to_del = [];
  let paths_to_create = [];
  try {
    const query = "select id, name from roles where name = any($1::text[])";
    const re = await client.query(query, [[parent_role, child_role]]);
    if (re.rowCount !== 2) {
      throw new Error("Role name not found");
    }
    if (re.rows[0].name === parent_role) {
      parent_id = re.rows[0].id;
      child_id = re.rows[1].id;
    } else {
      child_id = re.rows[0].id;
      parent_id = re.rows[1].id;
    }

    const que = "select path from paths where path ~ $1::lquery";

    const anypath = await client.query(que, [`*.${parent_id}.${child_id}.*`]);
    if (anypath.rowCount === 0) {
      throw new Error("No path between roles");
    }
    // getting all paths from that go through parent node and child node
    const get_paths_to_del = "SELECT id FROM paths WHERE path ~ $1::lquery";
    const pps = await client.query(get_paths_to_del, [
      `*.${parent_id}.${child_id}.*`,
    ]);
    path_ids_to_del = pps.rows.map((x) => x.id);

    // find out if the child has any other paths to root, or after this delete, will become a root
    // itself. In the latter case, need to create root node for child and also create paths for descendents
    // of child

    const check_child_root_paths =
      "select path from paths where path ~ $1::lquery";
    const des = await client.query(check_child_root_paths, [
      `*.!${parent_id}.${child_id}`,
    ]);
    if (des.rowCount === 0) {
      // getting all subpaths that start from child node onwards - we can insert them as is
      const query =
        "SELECT distinct role, subpath(path, index(path, $1::ltree)) as subpath FROM paths WHERE path ~ $2::lquery;";
      const result = await client.query(query, [child_id, `*.${child_id}.*`]);
      paths_to_create = result.rows;
    }
  } catch (e) {
    client.release();
    res.status(400).send(e.message);
    return;
  }
  try {
    await client.query("BEGIN");
    const query = "delete from paths where id = any($1::uuid[])";
    const result = await client.query(query, [path_ids_to_del]);
    // if paths_to_create is not empty, enter the id, subpath into the paths table
    // as is
    console.log(paths_to_create);
    for (let p of paths_to_create) {
      const query =
        "insert into paths (role, path) values ($1::int, $2::ltree)";
      await client.query(query, [p.role, p.subpath]);
    }
    await client.query("COMMIT");
    const html = await render_main_page();
    res.send(html);
  } catch (e) {
    await client.query("ROLLBACK");

    throw e;
  } finally {
    client.release();
  }
});

app.post("/deleteRole", async (req, res) => {
  const role = req.body.rolename;

  let role_id;
  let path_ids_to_del = [];
  let direct_child_ids = [];
  let child_paths_to_create = [];
  const client = await pool.connect();
  try {
    const query = "select id from roles where name = $1::text";
    const result = await client.query(query, [role]);
    if (result.rows.rowCount === 0) {
      throw new Error("Role does not exist");
    }
    role_id = result.rows[0].id;

    // getting all paths that have the role_id in them
    const que = "select id from paths where path ~ $1::lquery";
    const pr = await client.query(que, [`*.${role_id}.*`]);
    for (let x of pr.rows) {
      path_ids_to_del.push(x.id);
    }

    // getting direct child ids
    const quer = "select role from paths where path ~ $1::lquery";
    const cr = await client.query(quer, [`*.${role_id}.*{1,1}`]);
    for (let x of cr.rows) {
      direct_child_ids.push(x.role);
    }

    // for all children, check if they have some other path to a root node

    for (let child_id of direct_child_ids) {
      const check_child_root_paths =
        "select path from paths where path ~ $1::lquery";
      const des = await client.query(check_child_root_paths, [
        `*.!${role_id}.${child_id}`,
      ]);
      if (des.rowCount === 0) {
        // getting all subpaths that start from child node onwards - we can insert them as is
        const query =
          "SELECT distinct role, subpath(path, index(path, $1::ltree)) as subpath FROM paths WHERE path ~ $2::lquery;";
        const result = await client.query(query, [child_id, `*.${child_id}.*`]);
        child_paths_to_create = child_paths_to_create.concat(result.rows);
      }
    }
  } catch (e) {
    client.release();
    res.status(400).send(e.message);
    return;
  }

  try {
    await client.query("BEGIN");
    const query = "delete from paths where id = any($1::uuid[])";
    const result = await client.query(query, [path_ids_to_del]);
    // if child_paths_to_create is not empty, enter the id, subpath into the paths table
    // as is
    console.log(child_paths_to_create);
    for (let p of child_paths_to_create) {
      const query =
        "insert into paths (role, path) values ($1::int, $2::ltree)";
      await client.query(query, [p.role, p.subpath]);
    }

    // finally, delete the role from the roles table
    await client.query("delete from roles where name = $1::text", [role]);
    await client.query("COMMIT");

    const html = await render_main_page();
    res.send(html);
  } catch (e) {
    await client.query("ROLLBACK");

    throw e;
  } finally {
    client.release();
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

async function render_main_page() {
  const client = await pool.connect();
  let html = "";
  try {
    const query =
      "select roles.id, name, ltree2text(path) as path from paths join roles on roles.id = paths.role order by paths.path";
    const result = await client.query(query);
    let entries = result.rows;
    let nodes = {};
    let paths = [];
    for (let entry of entries) {
      nodes[entry.id] = entry.name;
      paths.push(entry.path);
    }
    let sas = "";
    for (let node in nodes) {
      sas = sas + `${node} [label=${nodes[node]}];`;
    }
    for (let path of paths) {
      p = path.replace(/\./g, "->");
      sas = sas + `${p};`;
    }

    html = render(`strict digraph {${sas}}`, Object.values(nodes));
  } catch (e) {
    throw e;
  } finally {
    client.release();
  }
  return html;
}

function render(dot_string, roles) {
  let option_tags = "";
  for (role of roles) {
    option_tags = option_tags + `<option value="${role}">${role}</option>`;
  }

  const html = `
<!DOCTYPE html>
<meta charset="utf-8">
<body>
<script src="//d3js.org/d3.v5.min.js"></script>
<script src="https://unpkg.com/@hpcc-js/wasm@0.3.11/dist/index.min.js"></script>
<script src="https://unpkg.com/d3-graphviz@3.0.5/build/d3-graphviz.js"></script>
<div id="graph" style="text-align: center;"></div>
<script>

d3.select("#graph").graphviz()
    .renderDot('${dot_string}', startApp);

function startApp() {
    var nodes = d3.selectAll(".node");
    var edges = d3.selectAll(".edge");
}

</script>
<h2> Create New Role </h2>
<form action="createRole" method="post" >
  <label for="rolename">Enter name of role you want to create:</label><br>
  <input name="rolename" type="text" id="rolename"><br><br>
  <button type="submit">Create Role</button>
</form>
</br>
<h2> Create New Relation </h2>
<form action="createRelation" method="post" >
  <label for="fromRole">Enter name of parent role:</label><br>
  <select name="fromRole" id="fromRole">${option_tags}</select><br><br>
  <label for="toRole">Enter name of child role:</label><br>
  <select name="toRole" id="toRole">${option_tags}</select><br><br>
  <button type="submit">Create Relation</button>
</form>
</br>
<h2> Delete Relation </h2>
<form action="deleteRelation" method="post" >
  <label for="fromRole">Enter name of parent role:</label><br>
  <select name="fromRole" id="fromRole">${option_tags}</select><br><br>
  <label for="toRole">Enter name of child role:</label><br>
  <select name="toRole" id="toRole">${option_tags}</select><br><br>
  <button type="submit">Delete Relation</button>
</form>
</br>
<h2> Delete Role </h2>
<form action="deleteRole" method="post" >
  <label for="rolename">Enter role to delete:</label><br>
  <select name="rolename" id="rolename">${option_tags}</select><br><br>
  <button type="submit">Delete Role</button>
</form>
</br>
<h2> Check for role mapping </h2>
<form action="checkRoleMapping" method="post" >
  <label for="roleToCheck">Enter name of role to check:</label><br>
  <select name="roleToCheck" id="roleToCheck">${option_tags}</select><br><br>
  <label for="toRole">Enter all roles you possess (use Shift/Ctrl to select):</label><br>
  <select name="ownedRoles" id="ownedRoles" multiple size="${roles.length}">${option_tags}</select><br><br>
  <button type="submit">Check</button>
</form>
  </body>
</html>
`;
  return html;
}
