declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export const expect: any;
  export const mock: {
    <T extends (...args: any[]) => any>(implementation?: T): T;
    module(specifier: string, factory: () => Record<string, unknown>): void;
  };
}
