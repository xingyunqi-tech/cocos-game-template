import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { loadLocalEnv } from './lib/cocos.mjs';
import { prepareUpload, REMOTE_DIR_ENV, remoteCommand, uploadDouyin, uploadWechat } from './lib/upload.mjs';

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        version: { type: 'string' },
        desc: { type: 'string' },
        robot: { type: 'string', default: '1' },
        'dry-run': { type: 'boolean', default: false },
    },
});

loadLocalEnv();

const [platform] = positionals;
let plan;
try {
    plan = prepareUpload(platform, { version: values.version, desc: values.desc, robot: Number(values.robot) });
} catch (err) {
    console.error(`✗ 上传前检查失败：\n${err.message}`);
    process.exit(1);
}

console.log(`${platform} ${plan.appid} v${plan.version}：${plan.projectPath}`);
if (values['dry-run']) {
    console.log('✓ 检查通过（dry-run，未上传）');
    process.exit(0);
}

if (plan.remote) {
    console.log(`上传 remote：${plan.remote.dir}`);
    const result = spawnSync(remoteCommand(plan.remote.command), {
        shell: true,
        stdio: 'inherit',
        env: { ...process.env, [REMOTE_DIR_ENV]: plan.remote.dir },
    });
    if (result.status !== 0) {
        console.error('✗ remote 上传失败');
        process.exit(1);
    }
}

try {
    if (platform === 'wechat') await uploadWechat(plan);
    else await uploadDouyin(plan);
    console.log(`✓ ${platform} 上传完成`);
} catch (err) {
    console.error(`✗ ${platform} 上传失败：${err.message ?? err}`);
    process.exit(1);
}
