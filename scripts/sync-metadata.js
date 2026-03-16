import fs from 'fs';
import { glob } from 'glob';

async function sync() {
    const rootPkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

    const sharedFields = {
        author: rootPkg.author,
        license: rootPkg.license,
        repository: rootPkg.repository,
        bugs: rootPkg.bugs,
        homepage: rootPkg.homepage,
        version: rootPkg.version,
    };

    const packagePaths = await glob('packages/*/package.json');

    packagePaths.forEach(pkgPath => {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

        const updatedPkg = { ...pkg, ...sharedFields };

        fs.writeFileSync(pkgPath, JSON.stringify(updatedPkg, null, 2) + '\n');
        console.log(`✅ Synced metadata for: ${pkg.name}`);
    });
}

sync().catch(console.error);
