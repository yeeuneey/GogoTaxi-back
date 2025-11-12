declare module 'node-fetch' {
  const fetch: typeof globalThis.fetch;
  export default fetch;
}

declare module 'bcrypt' {
  export function hash(data: string, saltOrRounds: number | string): Promise<string>;
  export function compare(data: string, encrypted: string): Promise<boolean>;
}
