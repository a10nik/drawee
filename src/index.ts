import * as _ from 'lodash';
import * as Phaser from 'phaser';

var config: Phaser.Types.Core.GameConfig = {
    type: Phaser.WEBGL,
    parent: 'game',
    width: 800,
    height: 600,
    backgroundColor: "#7FFFD4",
    scene: {
        preload: preload,
        create: create,
        update: update,
    }
};

var game = new Phaser.Game(config);

function preload() {
    const scene: Scene = this;
    // Load in images and sprites
    scene.load.atlas('human', '/resources/human/human.png', '/resources/human/human.json');
    scene.load.image('water', '/resources/textures/water.png');
    scene.load.glsl('someShader', '/resources/shaders/bundle.glsl');
}


type Direction = "W" | "NW" | "N" | "NE" | "E" | "SE" | "S" | "SW";
const directions: Direction[] = ["W", "NW", "N", "NE", "E", "SE", "S", "SW"];

type AnimState = {
    frame: number,
    state: "walk" | "idle",
    direction: Direction,
    lastFrameChange: number,
};

const mapInfo = {
    height: 10000,
    width: 10000,
    spawn: { x: 5000, y: 5000 },
};
type MapInfo = typeof mapInfo;
type Model = {
    player: Player
}
type Vec2D = { x: number, y: number };
type Player = {
    spell: Vec2D[]
}

type Scene = Phaser.Scene & {
    player: Phaser.GameObjects.Sprite,
    moveKeys: Record<'up' | 'down' | 'right' | 'left', { isDown: boolean }>,
    animState: AnimState,
    spell: Spell,
    text: Phaser.GameObjects.Text,
    mapInfo: MapInfo,
    model: Model,
}

class Spell extends Phaser.GameObjects.Polygon {
    private minX: number;
    private minY: number;
    private maxX: number;
    private maxY: number;
    addPoint(x: number, y: number) {
        this.pathData.push(x, y);
        if (this.minX === undefined) {
            this.minX = x;
            this.maxX = x;
            this.minY = y;
            this.maxY = y;
        } else {
            if (x < this.minX) {
                this.minX = x;
            } else if (x > this.maxX) {
                this.maxX = x;
            }
            if (y < this.minY) {
                this.minY = y;
            } else if (y > this.maxY) {
                this.maxY = y;
            }    
        }
    }
    get box() {
        return new Phaser.Geom.Rectangle(this.minX, this.minY, this.maxX - this.minX, this.maxY - this.minY);
    };
}

class GrayscalePipeline extends Phaser.Renderer.WebGL.Pipelines.TextureTintPipeline {
    constructor() {
        super({
            game,
            renderer: game.renderer,
            fragShader: `
            precision mediump float;
            uniform vec2  resolution;
            uniform float tx;
            uniform float ty;
            uniform float r;
            uniform sampler2D uMainSampler;
            varying vec2 outTexCoord;
            vec3 makeCircle(vec2 st,vec2 center, vec3 col){
                float d = distance(st,center);
                float pct = smoothstep(r,r+0.1,d);
                return vec3(1.0-pct)*col;
            } 
            void main(void) {
                    // st is the normalized position of the pixel in the scene
                vec2 st = vec2(gl_FragCoord.x/resolution.x,gl_FragCoord.y/resolution.y);
                vec4 color = texture2D(uMainSampler, outTexCoord);
                gl_FragColor = color*vec4(makeCircle(st,vec2(tx,ty),vec3(1.0)),1.0);
            }
            `,
        });
    }
}

function createScene(scene: Scene, map: MapInfo) {
    const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const pipeline = renderer.addPipeline('Grayscale', new GrayscalePipeline());
    scene.cameras.main.setRenderToTexture(pipeline);

    const player = scene.add.sprite(0, 0, 'human');
    player.setDepth(1);
    const text = scene.add.text(200, 200, []);
    text.setScrollFactor(0);
    text.setDepth(2);

    player.setOrigin(0.5, 0.5);
    

    scene.cameras.main.zoom = 1;
    scene.cameras.main.startFollow(player);
    scene.text = text;
    scene.mapInfo = map;
    const moveKeys = scene.input.keyboard.addKeys({
        'up': Phaser.Input.Keyboard.KeyCodes.W,
        'down': Phaser.Input.Keyboard.KeyCodes.S,
        'left': Phaser.Input.Keyboard.KeyCodes.A,
        'right': Phaser.Input.Keyboard.KeyCodes.D
    });
    scene.moveKeys = moveKeys as any;
    scene.player = player;
    scene.animState = {
        direction: "N",
        frame: 0,
        lastFrameChange: 0,
        state: "idle"
    };
    scene.input.on('pointerdown', function () {
        const spell = new Spell(scene, 0, 0, [scene.input.mousePointer.worldX, scene.input.mousePointer.worldY]);
        scene.add.existing(spell);
        scene.spell = spell;
        scene.spell.setStrokeStyle(2, 0xff0000);
    });
    scene.input.on('pointerup', function () {
        const bounds: Phaser.Geom.Rectangle = scene.spell.box;
        console.log("shader", scene.spell.box, bounds.centerX, bounds.centerY, bounds.width, bounds.height)
        scene.spell.destroy();
    });
}

function create() {
    const scene: Scene = this;
    createScene(scene, mapInfo);
}

function getDelta(s: Scene) {
    const y = (s.moveKeys.up.isDown ? -1 : 0) + (s.moveKeys.down.isDown ? 1 : 0);
    const x = (s.moveKeys.left.isDown ? -1 : 0) + (s.moveKeys.right.isDown ? 1 : 0);
    const r = new Phaser.Math.Vector2(x, y);
    return r.normalize().scale(5);
}

function getFrame(anim: AnimState) {
    return anim.state === "walk" ? `${anim.direction.toLowerCase()}_p${anim.frame + 1}` : anim.direction.toLowerCase();
}

const FPS = 15;
const frameInterval = 1000 / FPS;

function getNext(anim: AnimState, dx: number, dy: number, time: number): AnimState {
    const newState = dx !== 0 || dy !== 0 ? "walk" : "idle";
    const frameChange = time - anim.lastFrameChange > frameInterval ? 1 : 0;
    const nextFrame = anim.state === newState && newState === "walk" ? (anim.frame + frameChange) % 8 : 0;
    const direction = getClosestDir(dx, dy) || anim.direction;
    return {
        ...anim,
        frame: nextFrame,
        direction,
        state: newState,
        lastFrameChange: nextFrame != anim.frame ? time : anim.lastFrameChange
    };
}

function getClosestDir(dx: number, dy: number): Direction {
    if (dx > 0 && dy === 0) {
        return "E";
    }
    if (dx < 0 && dy === 0) {
        return "W";
    }
    if (dx > 0 && dy > 0) {
        return "SE";
    }
    if (dx > 0 && dy < 0) {
        return "NE";
    }
    if (dx < 0 && dy > 0) {
        return "SW";
    }
    if (dx < 0 && dy < 0) {
        return "NW";
    }
    if (dx === 0 && dy < 0) {
        return "N";
    }
    if (dx === 0 && dy > 0) {
        return "S";
    }
    return null;
}

let lastDrawTime = 0;
const drawInterval = 1000 / 30;
function drawLine(time: number, scene: Scene, x: number, y: number) {
    if (time - lastDrawTime > drawInterval) {
        // console.log("drawing a line to ", x, y);
        scene.spell.addPoint(x, y);
        lastDrawTime = time;
    }
}

function update(time: number) {
    const { text, player, animState, moveKeys, input, cameras }: Scene = this;
    const { x, y } = getDelta(this);
    player.x += x;
    player.y += y;
    text.setText(`coords: ${player.x}, ${player.y}`);
    const newAnimState = getNext(animState, x, y, time);
    player.frame = player.texture.get(getFrame(newAnimState));
    this.animState = newAnimState;

    input.mousePointer.updateWorldPoint(cameras.main);
    if (input.mousePointer.isDown) {
        drawLine(time, this, input.mousePointer.worldX, input.mousePointer.worldY);
    }
}
