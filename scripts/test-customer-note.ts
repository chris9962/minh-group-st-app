import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { CustomerNoteForm, CustomerExportRow } from "../src/lib/api/customers";
import type { User } from "../src/lib/types";

// Chỉ chạy trên Postgres cục bộ, tạo database riêng và xoá trong finally.
const database = `mgst_note_test_${Date.now()}`;
const baseUrl = "postgres://mgst:mgst@127.0.0.1:5433/";
const admin = new Pool({ connectionString: `${baseUrl}postgres` });
let testPool: Pool | undefined;
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  process.env.DATABASE_URL = `${baseUrl}${database}`;
  testPool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Mỗi migration một giao dịch: các migration sau dùng enum đã thêm trước đó.
  const connection = await testPool.connect();
  try {
    for (const migration of readMigrationFiles({ migrationsFolder: "./drizzle" })) {
      await connection.query("BEGIN");
      for (const statement of migration.sql) await connection.query(statement);
      await connection.query("COMMIT");
    }
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
  }
  const { db } = await import("../src/server/db/client");
  const { users, customers } = await import("../src/server/db/schema");
  const { updateCustomerNote, listCustomersForExport } = await import("../src/server/customers");
  const ownerId = randomUUID();
  const otherId = randomUUID();
  await db.insert(users).values([ownerId, otherId].map((id) => ({
    id, username: `ZZE2E_${id}`, passwordHash: "test", fullName: "ZZE2E Ghi chú",
    phone: "0900000000", role: "staff" as const, title: "Nhân viên",
  })));
  const rootId = randomUUID();
  const secondId = randomUUID();
  await db.insert(customers).values({
    id: rootId, rootCustomerId: rootId, fullName: "ZZE2E Ghi chú", createdBy: ownerId,
  });
  await db.insert(customers).values({
    id: secondId, rootCustomerId: rootId, seq: 2,
    fullName: "ZZE2E Ghi chú", createdBy: ownerId,
  });
  const actor: User = {
    id: ownerId, username: "ZZE2E_note", fullName: "ZZE2E Ghi chú", role: "staff",
    departmentId: null, managedDepartmentIds: [], managedBankIds: [],
    manageScope: "none", title: "Nhân viên", active: true,
    permissions: [{ module: "customer", action: "update", scope: "own" }],
  };
  const note = "Khách hẹn gọi lại chiều mai.\nGiữ nguyên dấu tiếng Việt và số 001.";
  assert.equal((await updateCustomerNote(actor, secondId, note))?.note, note);
  assert.equal(await updateCustomerNote({ ...actor, id: otherId }, secondId, "Sai phạm vi"), null);
  assert.equal(await updateCustomerNote({ ...actor, permissions: [] }, secondId, "Thiếu quyền"), null);
  assert.equal(await updateCustomerNote(actor, randomUUID(), note), null);
  await updateCustomerNote(actor, secondId, note);
  const saved = await testPool.query("SELECT id, note FROM customers ORDER BY seq");
  assert.equal(saved.rows[0].note, "");
  assert.equal(saved.rows[1].note, note);
  const history = await testPool.query("SELECT field, from_value, to_value FROM customer_changes");
  assert.equal(history.rows.length, 1);
  assert.equal(history.rows[0].field, "note");
  assert.equal(history.rows[0].to_value, note);
  const exported = await listCustomersForExport({ search: "ZZE2E", channelId: "", from: "", to: "" });
  assert.equal(CustomerExportRow.parse(exported.rows.find((row) => row.id === secondId)).note, note);
  await updateCustomerNote(actor, secondId, "");
  assert.equal((await testPool.query("SELECT note FROM customers WHERE id = $1", [secondId])).rows[0].note, "");
  assert(CustomerNoteForm.safeParse({ note: "" }).success);
  assert(CustomerNoteForm.safeParse({ note: "a".repeat(5000) }).success);
  assert(!CustomerNoteForm.safeParse({ note: "a".repeat(5001) }).success);
  console.log("PASS: migration, lưu/xoá ghi chú, phạm vi, quyền, lịch sử, hồ sơ riêng và dữ liệu xuất.");
} finally {
  await testPool?.end();
  // Pool app được cache trên globalThis; đóng trước khi xoá database test.
  await (globalThis as unknown as { mgstPool?: Pool }).mgstPool?.end();
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  await admin.end();
}
