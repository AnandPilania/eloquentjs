import { colors } from '../utils.js'

export async function cmdList() {
    const commands = [
        {
            group: 'Project',
            items: [
                { cmd: 'init', args: '', desc: 'Initialize EloquentJS in the current project' },
            ],
        },
        {
            group: 'Make',
            items: [
                { cmd: 'make:model', args: '<Name>', desc: 'Generate a new model class' },
                { cmd: 'make:model', args: '<Name> --migration', desc: 'Generate model + migration together' },
                { cmd: 'make:model', args: '<Name> --all', desc: 'Generate model + migration + factory + seeder' },
                { cmd: 'make:migration', args: '<name>', desc: 'Generate a new migration file' },
                { cmd: 'make:seeder', args: '<Name>', desc: 'Generate a new seeder class' },
                { cmd: 'make:factory', args: '<Name>', desc: 'Generate a new factory class' },
            ],
        },
        {
            group: 'Migrate',
            items: [
                { cmd: 'migrate', args: '', desc: 'Run all pending migrations' },
                { cmd: 'migrate:rollback', args: '', desc: 'Rollback the last batch of migrations' },
                { cmd: 'migrate:rollback', args: '--step=<n>', desc: 'Rollback N batches' },
                { cmd: 'migrate:reset', args: '', desc: 'Rollback all migrations' },
                { cmd: 'migrate:refresh', args: '', desc: 'Reset and re-run all migrations' },
                { cmd: 'migrate:fresh', args: '', desc: 'Drop all tables and re-run migrations' },
                { cmd: 'migrate:fresh', args: '--seed', desc: 'Drop all tables, migrate, then seed' },
                { cmd: 'migrate:status', args: '', desc: 'Show the status of each migration' },
            ],
        },
        {
            group: 'Generate (from live models)',
            items: [
                { cmd: 'generate:graphql', args: '', desc: 'Generate schema.graphql from all models' },
                { cmd: 'generate:graphql', args: '--models=User,Post', desc: 'Generate for specific models only' },
                { cmd: 'generate:graphql', args: '--out=<file>', desc: 'Custom output path' },
                { cmd: 'generate:graphql', args: '--pagination=relay', desc: 'Use Relay cursor pagination' },
                { cmd: 'generate:types', args: '', desc: 'Generate TypeScript types (models.d.ts)' },
                { cmd: 'generate:types', args: '--out=<file>', desc: 'Custom output path' },
                { cmd: 'generate:openapi', args: '', desc: 'Generate OpenAPI 3.0 spec (openapi.json)' },
                { cmd: 'generate:openapi', args: '--format=yaml', desc: 'Output as YAML' },
                { cmd: 'generate:openapi', args: '--out=<file>', desc: 'Custom output path' },
            ],
        },
        {
            group: "Seeder",
            items: [
                { cmd: 'db:seed', args: '', desc: 'Run the DatabaseSeeder' },
                { cmd: 'db:seed', args: '--class=<SeederName>', desc: 'Run a specific seeder class' },
                { cmd: 'db:wipe', args: '', desc: 'Drop all tables, views, and types' },
            ],
        },
    ]

    console.log(`\n${colors.bold}Available Commands${colors.reset}\n`)

    for (const { group, items } of commands) {
        console.log(`  ${colors.yellow}${group}${colors.reset}`)
        for (const { cmd, args, desc } of items) {
            const left = `    ${colors.cyan}eloquent ${cmd}${colors.reset} ${colors.gray}${args}${colors.reset}`
            const padded = left.padEnd(72 + (colors.cyan.length + colors.reset.length + colors.gray.length + colors.reset.length))
            console.log(`${padded}  ${colors.dim || ''}${desc}${colors.reset}`)
        }
        console.log()
    }

    console.log(`  ${colors.gray}Global Flags${colors.reset}`)
    console.log(`    ${colors.cyan}--verbose${colors.reset}  Show full error stack traces`)
    console.log(`    ${colors.cyan}--force${colors.reset}    Overwrite existing files`)
    console.log()
}
