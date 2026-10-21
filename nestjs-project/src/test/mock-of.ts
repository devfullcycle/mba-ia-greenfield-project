/**
 * Maps every method of T to a plain `jest.Mock` property. Unlike
 * `jest.Mocked<T>`, the members are not method declarations, so asserting on
 * them does not trip `@typescript-eslint/unbound-method`.
 */
export type MockOf<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? jest.Mock<R, A>
    : T[K];
};
