module.export = {
  name: 'LineUpJS',
  mode: 'modules',
  modules: 'umd',
  theme: 'minimal',
  target: 'es6',
  hideGenerator: true,
  ignoreCompilerErrors: false,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  moduleResolution: 'node',
  preserveConstEnums: true,
  stripInternal: true,
  suppressExcessPropertyErrors: true,
  suppressImplicitAnyIndexErrors: true,
  exclude: '**/*.(d.ts|js|test.ts|scss)',
  excludePrivate: true,
  excludeProtected: true,
  excludeExternals: true
};
