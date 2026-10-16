import { _decorator, Color, Component, Graphics, Node, UITransform } from 'cc';
import { destroyNow } from 'db://game-core';

const { ccclass } = _decorator;

const COLORS = [new Color(255, 136, 0), new Color(46, 160, 67), new Color(66, 133, 244), new Color(219, 68, 55)];

interface Target {
    node: Node;
    life: number;
}

/** 限时点击目标：目标随机出现，点中加分 */
@ccclass('DemoTapGame')
export class TapGame extends Component {
    duration = 20;
    spawnInterval = 0.7;
    targetLife = 1.3;
    radius = 56;
    onScore: (score: number) => void = () => undefined;
    onTick: (remaining: number) => void = () => undefined;
    onFinish: (score: number) => void = () => undefined;

    private remaining = 0;
    private spawnTimer = 0;
    private score = 0;
    private targets: Target[] = [];
    private running = false;

    begin() {
        this.remaining = this.duration;
        this.spawnTimer = 0;
        this.score = 0;
        this.running = true;
        this.onTick(Math.ceil(this.remaining));
    }

    update(dt: number) {
        if (!this.running) return;
        this.remaining -= dt;
        this.onTick(Math.max(0, Math.ceil(this.remaining)));
        if (this.remaining <= 0) {
            this.finish();
            return;
        }
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
            this.spawnTimer = this.spawnInterval;
            this.spawn();
        }
        this.targets = this.targets.filter((target) => {
            target.life -= dt;
            if (target.life > 0 && target.node.isValid) return true;
            destroyNow(target.node);
            return false;
        });
    }

    private spawn() {
        const area = this.node.getComponent(UITransform)!.contentSize;
        const node = new Node('Target');
        node.layer = this.node.layer;
        node.addComponent(UITransform).setContentSize(this.radius * 2, this.radius * 2);
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = COLORS[Math.floor(Math.random() * COLORS.length)];
        graphics.circle(0, 0, this.radius);
        graphics.fill();
        const x = (Math.random() - 0.5) * (area.width - this.radius * 2);
        const y = (Math.random() - 0.5) * (area.height - this.radius * 2);
        node.setPosition(x, y);
        node.on(Node.EventType.TOUCH_START, () => this.hit(node));
        this.node.addChild(node);
        this.targets.push({ node, life: this.targetLife });
    }

    private hit(node: Node) {
        if (!this.running) return;
        this.score++;
        this.onScore(this.score);
        this.targets = this.targets.filter((target) => target.node !== node);
        destroyNow(node);
    }

    private finish() {
        this.running = false;
        for (const target of this.targets) destroyNow(target.node);
        this.targets = [];
        this.onFinish(this.score);
    }
}
