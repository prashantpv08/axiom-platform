import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

import ts from 'typescript';

export const APPROVED_CROSS_CONTEXT_POSTGRES_QUERIES = [
  // These owner-owned projections expose exact downstream reads without sharing repositories.
  'architecture/postgres-architecture-decision.query.ts',
  'artifacts/postgres-artifact-approval.query.ts',
  'experience/postgres-business-context-gate.query.ts'
] as const;

export const PROVIDER_SDK_IMPORT_PREFIXES = [
  '@anthropic-ai/sdk',
  '@aws-sdk/client-bedrock-runtime',
  '@google/generative-ai',
  '@google/genai',
  'cohere-ai',
  'groq-sdk',
  'mistralai',
  'openai'
] as const;

export type ArchitectureRule =
  | 'CROSS_CONTEXT_POSTGRES_REPOSITORY'
  | 'CROSS_CONTEXT_POSTGRES_QUERY'
  | 'SCHEMA_LEAF_BARREL_IMPORT'
  | 'APPLICATION_DOMAIN_DEPENDENCY'
  | 'DIRECT_IDEMPOTENCY_TABLE_IMPORT'
  | 'SERVICE_HTTP_EXCEPTION_IMPORT';

export type ArchitectureViolation = Readonly<{
  rule: ArchitectureRule;
  file: string;
  line: number;
  importSpecifier: string;
  message: string;
}>;

type ModuleReference = Readonly<{
  moduleSpecifier: string;
  namedImports: readonly string[];
  node: ts.Node;
}>;

type CheckArchitectureOptions = Readonly<{
  sourceRoot?: string;
}>;

function portablePath(value: string): string {
  return value.split(sep).join('/');
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(path);
  }
  return files;
}

function importNames(clause: ts.ImportClause | undefined): string[] {
  const namedImports: string[] = [];
  if (clause?.name !== undefined) namedImports.push('default');
  const bindings = clause?.namedBindings;
  if (bindings === undefined || ts.isNamespaceImport(bindings)) return namedImports;
  for (const element of bindings.elements) namedImports.push(element.propertyName?.text ?? element.name.text);
  return namedImports;
}

function moduleReferences(sourceFile: ts.SourceFile): ModuleReference[] {
  const references: ModuleReference[] = [];
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({
        moduleSpecifier: node.moduleSpecifier.text,
        namedImports: importNames(node.importClause),
        node
      });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      const namedImports = node.exportClause !== undefined && ts.isNamedExports(node.exportClause)
        ? node.exportClause.elements.map((element) => element.propertyName?.text ?? element.name.text)
        : [];
      references.push({
        moduleSpecifier: node.moduleSpecifier.text,
        namedImports,
        node
      });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (expression !== undefined && ts.isStringLiteral(expression)) {
        references.push({ moduleSpecifier: expression.text, namedImports: [], node });
      }
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]!)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        references.push({ moduleSpecifier: node.arguments[0]!.text, namedImports: [], node });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return references;
}

function resolveInternalImport(importer: string, specifier: string, files: ReadonlySet<string>): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(importer), specifier);
  const candidates = extname(base) === '.ts'
    ? [base]
    : [`${base}.ts`, join(base, 'index.ts')];
  return candidates.find((candidate) => files.has(candidate));
}

function boundedContext(sourceRoot: string, file: string): string | undefined {
  const path = portablePath(relative(sourceRoot, file));
  if (path.startsWith('../')) return undefined;
  const [context] = path.split('/');
  return context?.endsWith('.ts') === true ? undefined : context;
}

function isApplicationOrDomainFile(sourceRoot: string, file: string): boolean {
  const path = portablePath(relative(sourceRoot, file));
  const name = basename(file);
  return path.includes('/application/') ||
    /\.(?:service|schema|policy|compiler|evaluator)\.ts$/u.test(name);
}

function isProviderSdk(specifier: string): boolean {
  return PROVIDER_SDK_IMPORT_PREFIXES.some((prefix) =>
    specifier === prefix || specifier.startsWith(`${prefix}/`)
  );
}

function violation(
  sourceRoot: string,
  sourceFile: ts.SourceFile,
  reference: ModuleReference,
  rule: ArchitectureRule,
  message: string
): ArchitectureViolation {
  const location = sourceFile.getLineAndCharacterOfPosition(reference.node.getStart(sourceFile));
  return {
    rule,
    file: portablePath(relative(sourceRoot, sourceFile.fileName)),
    line: location.line + 1,
    importSpecifier: reference.moduleSpecifier,
    message
  };
}

export async function checkArchitecture(options: CheckArchitectureOptions = {}): Promise<ArchitectureViolation[]> {
  const sourceRoot = resolve(options.sourceRoot ?? join(process.cwd(), 'src'));
  const files = await sourceFiles(sourceRoot);
  const fileSet = new Set(files.map((file) => resolve(file)));
  const approvedQueries = new Set<string>(APPROVED_CROSS_CONTEXT_POSTGRES_QUERIES);
  const coordinator = resolve(sourceRoot, 'database/idempotency/postgres-idempotency.ts');
  const schemaCompatibilityBarrel = resolve(sourceRoot, 'database/schema.ts');
  const schemaIndexBarrel = resolve(sourceRoot, 'database/schema/index.ts');
  const violations: ArchitectureViolation[] = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const importerContext = boundedContext(sourceRoot, file);
    const importerRelative = portablePath(relative(sourceRoot, file));
    const schemaLeaf = importerRelative.startsWith('database/schema/') && importerRelative !== 'database/schema/index.ts';
    const applicationOrDomain = isApplicationOrDomainFile(sourceRoot, file);
    const service = basename(file).endsWith('.service.ts');

    for (const reference of moduleReferences(sourceFile)) {
      const target = resolveInternalImport(file, reference.moduleSpecifier, fileSet);
      const targetContext = target === undefined ? undefined : boundedContext(sourceRoot, target);
      const targetRelative = target === undefined ? undefined : portablePath(relative(sourceRoot, target));
      const targetName = target === undefined ? undefined : basename(target);
      const crossContext = importerContext !== undefined && targetContext !== undefined && importerContext !== targetContext;

      if (crossContext && targetName !== undefined && /^postgres-.*\.repository\.ts$/u.test(targetName)) {
        violations.push(violation(
          sourceRoot,
          sourceFile,
          reference,
          'CROSS_CONTEXT_POSTGRES_REPOSITORY',
          'Bounded contexts may not import another context\'s concrete Postgres repository.'
        ));
      }

      if (
        crossContext &&
        targetName !== undefined &&
        /^postgres-.*\.query\.ts$/u.test(targetName) &&
        (targetRelative === undefined || !approvedQueries.has(targetRelative))
      ) {
        violations.push(violation(
          sourceRoot,
          sourceFile,
          reference,
          'CROSS_CONTEXT_POSTGRES_QUERY',
          `Cross-context persistence reads must use an approved owner-owned query seam: ${APPROVED_CROSS_CONTEXT_POSTGRES_QUERIES.join(', ')}.`
        ));
      }

      if (schemaLeaf && (target === schemaCompatibilityBarrel || target === schemaIndexBarrel)) {
        violations.push(violation(
          sourceRoot,
          sourceFile,
          reference,
          'SCHEMA_LEAF_BARREL_IMPORT',
          'Database schema leaf modules must import other leaf modules directly, not the compatibility or index barrel.'
        ));
      }

      if (applicationOrDomain) {
        const importsController = targetName?.endsWith('.controller.ts') === true;
        const importsConcreteRepository = targetName !== undefined && /^postgres-.*\.repository\.ts$/u.test(targetName);
        if (importsController || importsConcreteRepository || isProviderSdk(reference.moduleSpecifier)) {
          violations.push(violation(
            sourceRoot,
            sourceFile,
            reference,
            'APPLICATION_DOMAIN_DEPENDENCY',
            'Application and domain schema/policy/compiler/evaluator files may not import controllers, provider SDKs, or concrete Postgres repositories.'
          ));
        }
      }

      if (file !== coordinator && reference.namedImports.includes('idempotencyRecords')) {
        violations.push(violation(
          sourceRoot,
          sourceFile,
          reference,
          'DIRECT_IDEMPOTENCY_TABLE_IMPORT',
          'Use the PostgreSQL idempotency coordinator; direct idempotency table imports are forbidden.'
        ));
      }

      if (
        service &&
        reference.moduleSpecifier === '@nestjs/common' &&
        reference.namedImports.some((name) => name === 'HttpStatus' || name.endsWith('Exception'))
      ) {
        violations.push(violation(
          sourceRoot,
          sourceFile,
          reference,
          'SERVICE_HTTP_EXCEPTION_IMPORT',
          'Services must use framework-neutral ApplicationError values; HTTP exceptions belong to platform/http.'
        ));
      }
    }
  }

  return violations.sort((left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line || left.rule.localeCompare(right.rule)
  );
}

async function main(): Promise<void> {
  const violations = await checkArchitecture();
  if (violations.length === 0) {
    process.stdout.write(
      `Architecture fitness checks passed. Approved cross-context Postgres query seams: ${APPROVED_CROSS_CONTEXT_POSTGRES_QUERIES.join(', ')}.\n`
    );
    return;
  }

  for (const item of violations) {
    process.stderr.write(`${item.file}:${item.line} [${item.rule}] ${item.message} Import: ${item.importSpecifier}\n`);
  }
  process.exitCode = 1;
}

if (require.main === module) void main();
