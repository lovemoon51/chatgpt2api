import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "user-keys-card.tsx"), "utf-8");

describe("UserKeysCard ordinary user guidance", () => {
  test("provides search, filters, and pagination for the admin user list", () => {
    expect(source).toContain("searchQuery");
    expect(source).toContain("statusFilter");
    expect(source).toContain("balanceFilter");
    expect(source).toContain("pageSize");
    expect(source).toContain("filteredItems");
    expect(source).toContain("paginatedItems");
    expect(source).toContain("搜索名称、邮箱、登录 IP 或用户 ID");
    expect(source).toContain("状态");
    expect(source).toContain("积分");
    expect(source).toContain("每页");
    expect(source).toContain("上一页");
    expect(source).toContain("下一页");
  });

  test("tells admins that ordinary users enter ColaAI instead of the legacy studio", () => {
    expect(source).toContain("普通用户只能进入 ColaAI");
    expect(source).not.toContain("普通用户只能进入创作台");
  });

  test("supports bulk one-time access code generation with total credit quota", () => {
    expect(source).toContain("批量生成访问码");
    expect(source).toContain("生成数量");
    expect(source).toContain("总积分");
    expect(source).toContain("全部积分");
    expect(source).toContain("有剩余积分");
    expect(source).toContain("不限积分");
    expect(source).toContain("新访问码仅展示一次");
    expect(source).not.toContain("总图片额度");
    expect(source).not.toContain("全部余额");
    expect(source).not.toContain("有余额");
    expect(source).not.toContain("每日图片");
    expect(source).not.toContain("图片/日");
  });

  test("shows admin user management fields for balance and login metadata", () => {
    expect(source).toContain("用户管理");
    expect(source).toContain("剩余积分");
    expect(source).toContain("已用积分");
    expect(source).toContain("登录 IP");
    expect(source).toContain("邮箱");
    expect(source).toContain("editEmail");
    expect(source).toContain("imagesUsed");
    expect(source).not.toContain("已用图片");
  });
});
