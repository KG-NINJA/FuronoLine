// ゲーム設定
const CONFIG = {
    canvasWidth: 800,
    canvasHeight: 600,
    worldHeight: 256 * 16,
    playerSpeed: 2,
    bulletSpeed: 8,
    bulletRange: 150, // 射程距離（ピクセル）- 接近戦を強制
    grenadeSpeed: 4,
    enemySpeed: 1,
    vehicleSpeed: 3,
    debugMode: false, // デバッグモード（Dキーで切り替え）
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const gameState = {
    player: null,
    camera: { x: 0, y: 0 },
    bullets: [],
    grenades: [],
    enemies: [],
    vehicles: [],
    enemyVehicles: [],
    particles: [],
    explosions: [],
    structures: [],
    airstrikes: [],
    keys: {},
    score: 0,
    gameOver: false,
    victory: false,
    logs: [],
    airstrikeTriggered: false, // 対地攻撃機イベントが既に発生したかのフラグ
};

function distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function rectCollision(r1, r2) {
    return r1.x < r2.x + r2.w && r1.x + r1.w > r2.x &&
           r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;
}

function logEvent(event, data) {
    gameState.logs.push({ timestamp: Date.now(), event, data });
}

class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.w = 12;
        this.h = 12;
        this.health = 100;
        this.maxHealth = 100;
        this.grenades = 5;
        this.speed = CONFIG.playerSpeed;
        this.shootCooldown = 0;
        this.grenadeCooldown = 0;
        this.vehicle = null;
        this.angle = -Math.PI / 2;
    }
    
    update() {
        if (this.vehicle) {
            this.x = this.vehicle.x;
            this.y = this.vehicle.y;
            return;
        }
        
        // 徒歩時はWASDのみで移動（矢印キーはビークル時の砲塔制御用）
        let dx = 0, dy = 0;
        if (gameState.keys['a']) dx -= 1;
        if (gameState.keys['d']) dx += 1;
        if (gameState.keys['w']) dy -= 1;
        if (gameState.keys['s']) dy += 1;
        
        if (dx !== 0 || dy !== 0) {
            const len = Math.sqrt(dx * dx + dy * dy);
            dx /= len;
            dy /= len;
            this.angle = Math.atan2(dy, dx);
        }
        
        const newX = this.x + dx * this.speed;
        const newY = this.y + dy * this.speed;
        
        if (newX >= 0 && newX + this.w <= CONFIG.canvasWidth) this.x = newX;
        if (newY >= 0 && newY + this.h <= CONFIG.worldHeight) this.y = newY;
        
        if (this.shootCooldown > 0) this.shootCooldown--;
        if (this.grenadeCooldown > 0) this.grenadeCooldown--;
        
        if (gameState.keys[' '] && this.shootCooldown === 0) {
            this.shoot();
            this.shootCooldown = 15;
        }
        
        if (gameState.keys['g'] && this.grenadeCooldown === 0 && this.grenades > 0) {
            this.throwGrenade();
            this.grenades--;
            this.grenadeCooldown = 60;
        }
    }
    
    shoot() {
        gameState.bullets.push(new Bullet(this.x + this.w / 2, this.y + this.h / 2, this.angle, 'player'));
    }
    
    throwGrenade() {
        gameState.grenades.push(new Grenade(this.x + this.w / 2, this.y + this.h / 2, this.angle));
    }
    
    takeDamage(amount) {
        this.health -= amount;
        if (this.health <= 0) {
            this.health = 0;
            endGame(false);
            logEvent('player_death', { position: { x: this.x, y: this.y } });
        }
    }
    
    draw() {
        if (this.vehicle) return;
        const screenY = this.y - gameState.camera.y;
        ctx.save();
        ctx.translate(this.x + this.w / 2, screenY + this.h / 2);
        ctx.rotate(this.angle + Math.PI / 2);
        ctx.fillStyle = '#0f0';
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(-6, 6);
        ctx.lineTo(6, 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

class Bullet {
    constructor(x, y, angle, owner) {
        this.x = x;
        this.y = y;
        this.w = 4;
        this.h = 4;
        this.angle = angle;
        this.owner = owner;
        this.speed = CONFIG.bulletSpeed;
        this.damage = 20;
        this.startX = x;
        this.startY = y;
        this.maxRange = CONFIG.bulletRange;
        this.isExplosive = false; // 爆発弾かどうか（戦車砲用）
        this.explosionRadius = 0; // 爆発半径
    }
    
    update() {
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
        
        // 射程距離チェック
        const distTraveled = distance(this.startX, this.startY, this.x, this.y);
        if (distTraveled > this.maxRange) {
            if (this.isExplosive) this.explode();
            return false;
        }
        
        if (this.x < 0 || this.x > CONFIG.canvasWidth || this.y < 0 || this.y > CONFIG.worldHeight) {
            if (this.isExplosive) this.explode();
            return false;
        }
        
        if (this.owner === 'player') {
            for (let i = gameState.enemies.length - 1; i >= 0; i--) {
                const enemy = gameState.enemies[i];
                if (rectCollision(this, enemy)) {
                    if (this.isExplosive) {
                        this.explode();
                    } else {
                        enemy.takeDamage(this.damage);
                        createParticles(this.x, this.y, '#f00', 5);
                    }
                    return false;
                }
            }
            for (const enemyVehicle of gameState.enemyVehicles) {
                if (rectCollision(this, enemyVehicle)) {
                    if (this.isExplosive) {
                        this.explode();
                    } else {
                        enemyVehicle.takeDamage(this.damage);
                        createParticles(this.x, this.y, '#fa0', 5);
                    }
                    return false;
                }
            }
            for (const struct of gameState.structures) {
                if (rectCollision(this, struct)) {
                    if (this.isExplosive) {
                        this.explode();
                    } else {
                        struct.takeDamage(this.damage);
                    }
                    return false;
                }
            }
        }
        
        if (this.owner === 'enemy' && gameState.player) {
            if (gameState.player.vehicle && rectCollision(this, gameState.player.vehicle)) {
                if (this.isExplosive) {
                    this.explode();
                } else {
                    gameState.player.vehicle.takeDamage(this.damage);
                }
                return false;
            } else if (!gameState.player.vehicle && rectCollision(this, gameState.player)) {
                if (this.isExplosive) {
                    this.explode();
                } else {
                    gameState.player.takeDamage(this.damage);
                    createParticles(this.x, this.y, '#0f0', 5);
                }
                return false;
            }
        }
        
        return true;
    }
    
    explode() {
        createExplosion(this.x, this.y, this.explosionRadius);
        
        // 範囲内の敵にダメージ
        for (const enemy of gameState.enemies) {
            const dist = distance(this.x, this.y, enemy.x + enemy.w / 2, enemy.y + enemy.h / 2);
            if (dist < this.explosionRadius) {
                enemy.takeDamage(this.damage * (1 - dist / this.explosionRadius));
            }
        }
        
        // 範囲内の敵ビークルにダメージ
        for (const enemyVehicle of gameState.enemyVehicles) {
            const dist = distance(this.x, this.y, enemyVehicle.x + enemyVehicle.w / 2, enemyVehicle.y + enemyVehicle.h / 2);
            if (dist < this.explosionRadius) {
                enemyVehicle.takeDamage(this.damage * (1 - dist / this.explosionRadius));
            }
        }
        
        // 範囲内の構造物にダメージ
        for (const struct of gameState.structures) {
            const dist = distance(this.x, this.y, struct.x + struct.w / 2, struct.y + struct.h / 2);
            if (dist < this.explosionRadius) {
                struct.takeDamage(this.damage * (1 - dist / this.explosionRadius));
            }
        }
        
        // プレイヤーへのダメージ（敵の戦車砲の場合）
        if (this.owner === 'enemy' && gameState.player) {
            const dist = distance(this.x, this.y, gameState.player.x + gameState.player.w / 2, gameState.player.y + gameState.player.h / 2);
            if (dist < this.explosionRadius) {
                if (gameState.player.vehicle) {
                    gameState.player.vehicle.takeDamage(this.damage * (1 - dist / this.explosionRadius));
                } else {
                    gameState.player.takeDamage(this.damage * (1 - dist / this.explosionRadius));
                }
            }
        }
    }
    
    draw() {
        const screenY = this.y - gameState.camera.y;
        
        if (this.isExplosive) {
            // 爆発弾は大きく、オレンジ色で描画
            ctx.fillStyle = this.owner === 'player' ? '#fa0' : '#f80';
            ctx.beginPath();
            ctx.arc(this.x, screenY, 4, 0, Math.PI * 2);
            ctx.fill();
            // 内側に光る点
            ctx.fillStyle = '#ff0';
            ctx.beginPath();
            ctx.arc(this.x, screenY, 2, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // 通常弾
            ctx.fillStyle = this.owner === 'player' ? '#ff0' : '#f00';
            ctx.fillRect(this.x - 2, screenY - 2, 4, 4);
        }
    }
}

class Grenade {
    constructor(x, y, angle) {
        this.x = x;
        this.y = y;
        this.w = 6;
        this.h = 6;
        this.vx = Math.cos(angle) * CONFIG.grenadeSpeed;
        this.vy = Math.sin(angle) * CONFIG.grenadeSpeed;
        this.timer = 90;
        this.damage = 50;
        this.radius = 40;
    }
    
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.timer--;
        
        if (this.x < 0 || this.x > CONFIG.canvasWidth) this.vx *= -0.5;
        if (this.y < 0 || this.y > CONFIG.worldHeight) this.vy *= -0.5;
        
        this.vx *= 0.95;
        this.vy *= 0.95;
        
        if (this.timer <= 0) {
            this.explode();
            return false;
        }
        return true;
    }
    
    explode() {
        createExplosion(this.x, this.y, this.radius);
        for (const enemy of gameState.enemies) {
            const dist = distance(this.x, this.y, enemy.x + enemy.w / 2, enemy.y + enemy.h / 2);
            if (dist < this.radius) {
                enemy.takeDamage(this.damage * (1 - dist / this.radius));
            }
        }
        for (const enemyVehicle of gameState.enemyVehicles) {
            const dist = distance(this.x, this.y, enemyVehicle.x + enemyVehicle.w / 2, enemyVehicle.y + enemyVehicle.h / 2);
            if (dist < this.radius) {
                enemyVehicle.takeDamage(this.damage * (1 - dist / this.radius));
            }
        }
        for (const struct of gameState.structures) {
            const dist = distance(this.x, this.y, struct.x + struct.w / 2, struct.y + struct.h / 2);
            if (dist < this.radius) {
                struct.takeDamage(this.damage * (1 - dist / this.radius));
            }
        }
        logEvent('grenade_explosion', { position: { x: this.x, y: this.y } });
    }
    
    draw() {
        const screenY = this.y - gameState.camera.y;
        const flash = this.timer < 30 && Math.floor(this.timer / 5) % 2 === 0;
        ctx.fillStyle = flash ? '#f00' : '#ff0';
        ctx.beginPath();
        ctx.arc(this.x, screenY, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

class Enemy {
    constructor(x, y, type = 'rifleman') {
        this.x = x;
        this.y = y;
        this.w = 12;
        this.h = 12;
        this.type = type;
        this.health = 40;
        this.maxHealth = 40;
        this.speed = CONFIG.enemySpeed;
        this.shootCooldown = 0;
        this.state = 'patrol';
        this.patrolDir = Math.random() < 0.5 ? -1 : 1;
        this.patrolRange = 50;
        this.originalX = x;
    }
    
    update() {
        if (!gameState.player) return true;
        
        const distToPlayer = distance(
            this.x + this.w / 2, this.y + this.h / 2,
            gameState.player.x + gameState.player.w / 2, gameState.player.y + gameState.player.h / 2
        );
        
        if (this.shootCooldown > 0) this.shootCooldown--;
        
        if (distToPlayer < 200 && this.y - gameState.player.y < 100) {
            this.state = 'aim';
            if (this.shootCooldown === 0) {
                this.shoot();
                this.shootCooldown = 60 + Math.random() * 60;
            }
        } else {
            this.state = 'patrol';
            this.x += this.patrolDir * this.speed * 0.5;
            if (Math.abs(this.x - this.originalX) > this.patrolRange) {
                this.patrolDir *= -1;
            }
        }
        return true;
    }
    
    shoot() {
        const angle = Math.atan2(gameState.player.y - this.y, gameState.player.x - this.x);
        gameState.bullets.push(new Bullet(this.x + this.w / 2, this.y + this.h / 2, angle, 'enemy'));
    }
    
    takeDamage(amount) {
        this.health -= amount;
        if (this.health <= 0) {
            gameState.score += 100;
            createParticles(this.x + this.w / 2, this.y + this.h / 2, '#f00', 10);
            const index = gameState.enemies.indexOf(this);
            if (index > -1) gameState.enemies.splice(index, 1);
            logEvent('enemy_killed', { type: this.type, position: { x: this.x, y: this.y } });
        }
    }
    
    draw() {
        const screenY = this.y - gameState.camera.y;
        ctx.fillStyle = this.state === 'aim' ? '#f00' : '#a00';
        ctx.fillRect(this.x, screenY, this.w, this.h);
        if (this.health < this.maxHealth) {
            ctx.fillStyle = '#000';
            ctx.fillRect(this.x, screenY - 5, this.w, 2);
            ctx.fillStyle = '#0f0';
            ctx.fillRect(this.x, screenY - 5, this.w * (this.health / this.maxHealth), 2);
        }
    }
}

class Vehicle {
    constructor(x, y, type = 'car') {
        this.x = x;
        this.y = y;
        this.type = type;
        this.w = type === 'tank' ? 24 : 20;
        this.h = type === 'tank' ? 28 : 24;
        this.armor = type === 'tank' ? 200 : 100;
        this.maxArmor = this.armor;
        this.speed = type === 'tank' ? CONFIG.vehicleSpeed * 0.7 : CONFIG.vehicleSpeed;
        this.occupied = false;
        this.shootCooldown = 0;
        this.fireRate = type === 'tank' ? 45 : 20;
        this.turretAngle = -Math.PI / 2; // 砲塔の向き（初期は上）
    }
    
    update() {
        if (!this.occupied) return true;
        const player = gameState.player;
        
        // 移動（WASD）
        let dx = 0, dy = 0;
        if (gameState.keys['a']) dx -= 1;
        if (gameState.keys['d']) dx += 1;
        if (gameState.keys['w']) dy -= 1;
        if (gameState.keys['s']) dy += 1;
        
        if (dx !== 0 || dy !== 0) {
            const len = Math.sqrt(dx * dx + dy * dy);
            dx /= len;
            dy /= len;
        }
        
        const newX = this.x + dx * this.speed;
        const newY = this.y + dy * this.speed;
        if (newX >= 0 && newX + this.w <= CONFIG.canvasWidth) this.x = newX;
        if (newY >= 0 && newY + this.h <= CONFIG.worldHeight) this.y = newY;
        
        // 砲塔の向き（矢印キー）
        let aimX = 0, aimY = 0;
        if (gameState.keys['ArrowLeft']) aimX -= 1;
        if (gameState.keys['ArrowRight']) aimX += 1;
        if (gameState.keys['ArrowUp']) aimY -= 1;
        if (gameState.keys['ArrowDown']) aimY += 1;
        
        if (aimX !== 0 || aimY !== 0) {
            this.turretAngle = Math.atan2(aimY, aimX);
        }
        
        if (this.shootCooldown > 0) this.shootCooldown--;
        if (gameState.keys[' '] && this.shootCooldown === 0) {
            this.shoot();
            this.shootCooldown = this.fireRate;
        }
        return true;
    }
    
    shoot() {
        const centerX = this.x + this.w / 2;
        const centerY = this.y + this.h / 2;
        
        if (this.type === 'tank') {
            // 戦車：砲塔の向きに爆発弾発射
            const bullet = new Bullet(centerX, centerY, this.turretAngle, 'player');
            bullet.damage = 80;
            bullet.w = 8;
            bullet.h = 8;
            bullet.isExplosive = true;
            bullet.explosionRadius = 45;
            gameState.bullets.push(bullet);
        } else {
            // 装甲車：砲塔の向きに3連射
            for (let i = -1; i <= 1; i++) {
                const spreadAngle = this.turretAngle + (i * 0.1);
                gameState.bullets.push(new Bullet(centerX, centerY, spreadAngle, 'player'));
            }
        }
    }
    
    takeDamage(amount) {
        this.armor -= amount;
        if (this.armor <= 0) {
            this.armor = 0;
            createExplosion(this.x + this.w / 2, this.y + this.h / 2, 50);
            if (this.occupied && gameState.player) {
                gameState.player.vehicle = null;
                gameState.player.takeDamage(30);
            }
            const index = gameState.vehicles.indexOf(this);
            if (index > -1) gameState.vehicles.splice(index, 1);
            logEvent('vehicle_destroyed', { type: this.type });
        }
    }
    
    draw() {
        const screenY = this.y - gameState.camera.y;
        const centerX = this.x + this.w / 2;
        const centerY = screenY + this.h / 2;
        
        // 車体
        ctx.fillStyle = this.type === 'tank' ? '#888' : '#666';
        ctx.fillRect(this.x, screenY, this.w, this.h);
        
        // 砲塔
        ctx.fillStyle = this.occupied ? '#0a0' : '#444';
        if (this.type === 'tank') {
            ctx.fillRect(this.x + 4, screenY + 4, this.w - 8, this.h - 8);
        } else {
            ctx.fillRect(this.x + 2, screenY + 2, this.w - 4, this.h - 4);
        }
        
        // 砲身（砲塔の向き）
        if (this.occupied) {
            ctx.strokeStyle = '#0f0';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            const barrelLength = this.type === 'tank' ? 16 : 12;
            ctx.lineTo(
                centerX + Math.cos(this.turretAngle) * barrelLength,
                centerY + Math.sin(this.turretAngle) * barrelLength
            );
            ctx.stroke();
        }
        
        // 装甲バー
        ctx.fillStyle = '#000';
        ctx.fillRect(this.x, screenY - 6, this.w, 3);
        ctx.fillStyle = '#fa0';
        ctx.fillRect(this.x, screenY - 6, this.w * (this.armor / this.maxArmor), 3);
    }
}

class EnemyVehicle {
    constructor(x, y, type = 'car') {
        this.x = x;
        this.y = y;
        this.type = type;
        this.w = type === 'tank' ? 24 : 20;
        this.h = type === 'tank' ? 28 : 24;
        this.armor = type === 'tank' ? 150 : 80;
        this.maxArmor = this.armor;
        this.speed = type === 'tank' ? 0.5 : 0.8;
        this.shootCooldown = 0;
        this.fireRate = type === 'tank' ? 90 : 60;
        this.turretAngle = Math.PI / 2; // 初期は下向き
        this.patrolDir = Math.random() < 0.5 ? -1 : 1;
        this.patrolRange = 100;
        this.originalX = x;
    }
    
    update() {
        if (!gameState.player) return true;
        
        const distToPlayer = distance(
            this.x + this.w / 2, this.y + this.h / 2,
            gameState.player.x + gameState.player.w / 2, gameState.player.y + gameState.player.h / 2
        );
        
        if (this.shootCooldown > 0) this.shootCooldown--;
        
        // プレイヤーが近くにいる場合
        if (distToPlayer < 250 && Math.abs(this.y - gameState.player.y) < 150) {
            // 砲塔をプレイヤーに向ける
            this.turretAngle = Math.atan2(
                gameState.player.y - this.y,
                gameState.player.x - this.x
            );
            
            // 射撃
            if (this.shootCooldown === 0) {
                this.shoot();
                this.shootCooldown = this.fireRate;
            }
        } else {
            // パトロール
            this.x += this.patrolDir * this.speed;
            if (Math.abs(this.x - this.originalX) > this.patrolRange) {
                this.patrolDir *= -1;
            }
        }
        
        return true;
    }
    
    shoot() {
        const centerX = this.x + this.w / 2;
        const centerY = this.y + this.h / 2;
        
        if (this.type === 'tank') {
            // 戦車：爆発弾
            const bullet = new Bullet(centerX, centerY, this.turretAngle, 'enemy');
            bullet.damage = 50;
            bullet.w = 8;
            bullet.h = 8;
            bullet.isExplosive = true;
            bullet.explosionRadius = 40;
            gameState.bullets.push(bullet);
        } else {
            // 装甲車：3連射
            for (let i = -1; i <= 1; i++) {
                const spreadAngle = this.turretAngle + (i * 0.15);
                gameState.bullets.push(new Bullet(centerX, centerY, spreadAngle, 'enemy'));
            }
        }
    }
    
    takeDamage(amount) {
        this.armor -= amount;
        if (this.armor <= 0) {
            this.armor = 0;
            createExplosion(this.x + this.w / 2, this.y + this.h / 2, 50);
            gameState.score += this.type === 'tank' ? 500 : 300;
            const index = gameState.enemyVehicles.indexOf(this);
            if (index > -1) gameState.enemyVehicles.splice(index, 1);
            logEvent('enemy_vehicle_destroyed', { type: this.type });
        }
    }
    
    draw() {
        const screenY = this.y - gameState.camera.y;
        const centerX = this.x + this.w / 2;
        const centerY = screenY + this.h / 2;
        
        // 車体（敵は赤系）
        ctx.fillStyle = this.type === 'tank' ? '#a44' : '#844';
        ctx.fillRect(this.x, screenY, this.w, this.h);
        
        // 砲塔
        ctx.fillStyle = '#600';
        if (this.type === 'tank') {
            ctx.fillRect(this.x + 4, screenY + 4, this.w - 8, this.h - 8);
        } else {
            ctx.fillRect(this.x + 2, screenY + 2, this.w - 4, this.h - 4);
        }
        
        // 砲身
        ctx.strokeStyle = '#f00';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        const barrelLength = this.type === 'tank' ? 16 : 12;
        ctx.lineTo(
            centerX + Math.cos(this.turretAngle) * barrelLength,
            centerY + Math.sin(this.turretAngle) * barrelLength
        );
        ctx.stroke();
        
        // 装甲バー
        ctx.fillStyle = '#000';
        ctx.fillRect(this.x, screenY - 6, this.w, 3);
        ctx.fillStyle = '#f80';
        ctx.fillRect(this.x, screenY - 6, this.w * (this.armor / this.maxArmor), 3);
    }
}

class Structure {
    constructor(x, y, type = 'bunker') {
        this.x = x;
        this.y = y;
        this.type = type;
        this.w = type === 'hq' ? 100 : 40;
        this.h = type === 'hq' ? 60 : 30;
        this.health = type === 'hq' ? 500 : 100;
        this.maxHealth = this.health;
    }
    
    update() {
        return this.health > 0;
    }
    
    takeDamage(amount) {
        this.health -= amount;
        if (this.health <= 0) {
            this.health = 0;
            createExplosion(this.x + this.w / 2, this.y + this.h / 2, 60);
            if (this.type === 'hq') {
                endGame(true);
            }
        }
    }
    
    draw() {
        const screenY = this.y - gameState.camera.y;
        ctx.fillStyle = this.type === 'hq' ? '#444' : '#555';
        ctx.fillRect(this.x, screenY, this.w, this.h);
        ctx.fillStyle = '#000';
        ctx.fillRect(this.x, screenY - 8, this.w, 4);
        ctx.fillStyle = this.type === 'hq' ? '#f00' : '#fa0';
        ctx.fillRect(this.x, screenY - 8, this.w * (this.health / this.maxHealth), 4);
        ctx.fillStyle = '#fff';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this.type === 'hq' ? 'HQ' : 'BUNKER', this.x + this.w / 2, screenY + this.h / 2 + 3);
    }
}

class Airstrike {
    constructor(y, direction = 1) {
        this.x = direction > 0 ? -50 : CONFIG.canvasWidth + 50;
        this.y = y;
        this.w = 40;
        this.h = 20;
        this.speed = 6;
        this.direction = direction;
        this.bombCooldown = 0;
        this.bombInterval = 15;
        this.warningTime = 120; // 2秒前に警告
        this.active = false;
        this.bombsDropped = 0; // 投下した爆弾の数
        this.maxBombs = 8; // 最大爆弾数
        this.targetingMode = false; // プレイヤー狙いモード
    }
    
    update() {
        if (this.warningTime > 0) {
            this.warningTime--;
            if (this.warningTime === 0) {
                this.active = true;
            }
            return true;
        }
        
        this.x += this.speed * this.direction;
        
        // プレイヤーのX座標付近に来たら狙撃モード
        if (gameState.player && !this.targetingMode) {
            const distToPlayer = Math.abs(this.x - gameState.player.x);
            if (distToPlayer < 150) {
                this.targetingMode = true;
            }
        }
        
        // 爆弾投下
        if (this.bombCooldown > 0) {
            this.bombCooldown--;
        } else {
            if (this.bombsDropped < this.maxBombs) {
                this.dropBomb();
                this.bombsDropped++;
                // プレイヤー狙いモードでは連続投下
                this.bombCooldown = this.targetingMode ? 8 : this.bombInterval;
            }
        }
        
        // 画面外に出たら削除
        if (this.direction > 0 && this.x > CONFIG.canvasWidth + 50) return false;
        if (this.direction < 0 && this.x < -50) return false;
        
        return true;
    }
    
    dropBomb() {
        let targetX = this.x;
        
        // プレイヤー狙いモード：プレイヤーの位置を予測して爆撃
        if (this.targetingMode && gameState.player) {
            // プレイヤーの少し前方を狙う（移動予測）
            const leadDistance = 20;
            targetX = gameState.player.x + (Math.random() - 0.5) * 40; // ±20ピクセルのランダム誤差
        }
        
        const grenade = new Grenade(targetX, this.y, Math.PI / 2);
        grenade.timer = 30; // 短い時間で爆発
        grenade.damage = 60;
        grenade.radius = 50;
        gameState.grenades.push(grenade);
        
        // プレイヤー狙いの時はログに記録
        if (this.targetingMode) {
            logEvent('airstrike_targeting_player', { x: targetX, y: this.y });
        }
    }
    
    draw() {
        if (!this.active) {
            // 警告表示をより目立つように
            const warningY = this.y - gameState.camera.y;

            // 赤い背景で警告エリアを表示
            ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
            ctx.fillRect(0, warningY - 25, CONFIG.canvasWidth, 50);

            // 警告テキストを点滅させてより目立つように
            const flash = Math.floor(this.warningTime / 5) % 2 === 0;
            ctx.fillStyle = flash ? '#ffffff' : '#ff0000';
            ctx.font = 'bold 24px monospace';
            ctx.textAlign = 'center';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.strokeText('⚠ AIR STRIKE INCOMING ⚠', CONFIG.canvasWidth / 2, warningY + 5);
            ctx.fillText('⚠ AIR STRIKE INCOMING ⚠', CONFIG.canvasWidth / 2, warningY + 5);

            return;
        }
        
        const screenY = this.y - gameState.camera.y;
        
        // 機体（三角形）
        ctx.save();
        ctx.translate(this.x, screenY);
        ctx.rotate(this.direction > 0 ? 0 : Math.PI);
        
        // 狙撃モード時は色を変える
        ctx.fillStyle = this.targetingMode ? '#f00' : '#c00';
        ctx.beginPath();
        ctx.moveTo(20, 0);
        ctx.lineTo(-20, -10);
        ctx.lineTo(-20, 10);
        ctx.closePath();
        ctx.fill();
        
        // 翼
        ctx.fillStyle = this.targetingMode ? '#c00' : '#900';
        ctx.fillRect(-10, -15, 20, 4);
        ctx.fillRect(-10, 11, 20, 4);
        
        // 狙撃モード時は警告マーク
        if (this.targetingMode) {
            ctx.fillStyle = '#ff0';
            ctx.font = 'bold 12px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('!', 0, -20);
        }
        
        ctx.restore();
    }
}

function createParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        gameState.particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            life: 30,
            color
        });
    }
}

function createExplosion(x, y, radius) {
    gameState.explosions.push({ x, y, radius, life: 20, maxLife: 20 });
    createParticles(x, y, '#fa0', 20);
}

function initGame() {
    gameState.player = new Player(CONFIG.canvasWidth / 2, CONFIG.worldHeight - 50);
    generateStage();
    updateCamera();
}

function generateStage() {
    const stageHeight = CONFIG.worldHeight;
    const sectionHeight = stageHeight / 5;
    
    for (let i = 0; i < 8; i++) {
        gameState.enemies.push(new Enemy(50 + Math.random() * (CONFIG.canvasWidth - 100), stageHeight - sectionHeight + Math.random() * (sectionHeight - 100)));
    }
    
    for (let i = 0; i < 10; i++) {
        gameState.enemies.push(new Enemy(50 + Math.random() * (CONFIG.canvasWidth - 100), stageHeight - sectionHeight * 2 + Math.random() * (sectionHeight - 100)));
    }
    gameState.vehicles.push(new Vehicle(CONFIG.canvasWidth / 2 - 10, stageHeight - sectionHeight * 2 + 200, 'car'));
    // 敵装甲車を追加
    gameState.enemyVehicles.push(new EnemyVehicle(150, stageHeight - sectionHeight * 2 + 300, 'car'));
    
    for (let i = 0; i < 12; i++) {
        gameState.enemies.push(new Enemy(50 + Math.random() * (CONFIG.canvasWidth - 100), stageHeight - sectionHeight * 3 + Math.random() * (sectionHeight - 100)));
    }
    gameState.structures.push(new Structure(100, stageHeight - sectionHeight * 3 + 100, 'bunker'));
    gameState.structures.push(new Structure(CONFIG.canvasWidth - 140, stageHeight - sectionHeight * 3 + 100, 'bunker'));
    // 敵装甲車を追加
    gameState.enemyVehicles.push(new EnemyVehicle(CONFIG.canvasWidth - 150, stageHeight - sectionHeight * 3 + 200, 'car'));
    
    for (let i = 0; i < 15; i++) {
        gameState.enemies.push(new Enemy(50 + Math.random() * (CONFIG.canvasWidth - 100), stageHeight - sectionHeight * 4 + Math.random() * (sectionHeight - 100)));
    }
    gameState.vehicles.push(new Vehicle(CONFIG.canvasWidth / 2 - 12, stageHeight - sectionHeight * 4 + 300, 'tank'));
    // 敵戦車を追加
    gameState.enemyVehicles.push(new EnemyVehicle(200, stageHeight - sectionHeight * 4 + 150, 'tank'));
    gameState.enemyVehicles.push(new EnemyVehicle(CONFIG.canvasWidth - 220, stageHeight - sectionHeight * 4 + 450, 'tank'));
    
    gameState.structures.push(new Structure(CONFIG.canvasWidth / 2 - 50, 100, 'hq'));
    for (let i = 0; i < 20; i++) {
        gameState.enemies.push(new Enemy(50 + Math.random() * (CONFIG.canvasWidth - 100), Math.random() * sectionHeight));
    }
}

// 対地攻撃機イベント（セクション3の中間地点）
function triggerAirstrikeEvent() {
    const stageHeight = CONFIG.worldHeight;
    const sectionHeight = stageHeight / 5;
    const airstrikeY = stageHeight - sectionHeight * 3 + 300; // セクション3の開始直後

    console.log('対地攻撃機イベント発生！位置:', airstrikeY);
    gameState.airstrikes.push(new Airstrike(airstrikeY, 1));
    gameState.airstrikes.push(new Airstrike(airstrikeY + 60, -1));

    logEvent('airstrike_triggered', { position: airstrikeY });
}

function updateCamera() {
    if (!gameState.player) return;
    const targetY = gameState.player.y - CONFIG.canvasHeight / 2;
    gameState.camera.y = Math.max(0, Math.min(targetY, CONFIG.worldHeight - CONFIG.canvasHeight));

    // ステージ3区間で対地攻撃機イベントをチェック（1回だけ発生）
    if (!gameState.airstrikeTriggered) {
        const stageHeight = CONFIG.worldHeight;
        const sectionHeight = stageHeight / 5;
        const section3Start = stageHeight - sectionHeight * 3;
        const section3End = stageHeight - sectionHeight * 4;

        // プレイヤーがステージ3区間に入ったらイベント発生
        if (gameState.player.y < section3Start && gameState.player.y > section3End) {
            triggerAirstrikeEvent();
            gameState.airstrikeTriggered = true; // フラグを立てて2度目の発生を防ぐ
        }
    }
}

function updateHUD() {
    const player = gameState.player;
    if (!player) return;
    
    document.getElementById('healthBar').style.width = (player.health / player.maxHealth * 100) + '%';
    document.getElementById('grenades').textContent = player.grenades;
    
    const vehicleInfo = document.getElementById('vehicleInfo');
    if (player.vehicle) {
        vehicleInfo.style.display = 'block';
        document.getElementById('vehicleBar').style.width = (player.vehicle.armor / player.vehicle.maxArmor * 100) + '%';
    } else {
        vehicleInfo.style.display = 'none';
    }
    
    const hq = gameState.structures.find(s => s.type === 'hq');
    if (hq) {
        document.getElementById('distance').textContent = Math.max(0, Math.floor((player.y - hq.y) / 16));
    }
    document.getElementById('score').textContent = gameState.score;
}

function endGame(victory) {
    gameState.gameOver = true;
    gameState.victory = victory;
    const gameOverDiv = document.getElementById('gameOver');
    const title = document.getElementById('gameOverTitle');
    const message = document.getElementById('gameOverMessage');
    
    if (victory) {
        title.textContent = 'MISSION COMPLETE';
        title.style.color = '#0f0';
        message.textContent = '本部を制圧しました！';
        gameState.score += 5000;
    } else {
        title.textContent = 'MISSION FAILED';
        title.style.color = '#f00';
        message.textContent = '戦死しました...';
    }
    
    document.getElementById('finalScore').textContent = gameState.score;
    gameOverDiv.style.display = 'block';
    console.log('Game Logs:', gameState.logs);
}

window.addEventListener('keydown', (e) => {
    // 矢印キーはそのまま、それ以外は小文字化
    const key = e.key.startsWith('Arrow') ? e.key : e.key.toLowerCase();
    gameState.keys[key] = true;
    
    // デバッグモード切り替え（Shift+D）
    if (e.key.toLowerCase() === 'd' && e.shiftKey) {
        CONFIG.debugMode = !CONFIG.debugMode;
        console.log('デバッグモード:', CONFIG.debugMode ? 'ON' : 'OFF');
    }
    
    if (e.key.toLowerCase() === 'e' && gameState.player) {
        const player = gameState.player;
        if (player.vehicle) {
            player.vehicle.occupied = false;
            player.vehicle = null;
        } else {
            for (const vehicle of gameState.vehicles) {
                if (!vehicle.occupied) {
                    const dist = distance(player.x + player.w / 2, player.y + player.h / 2, vehicle.x + vehicle.w / 2, vehicle.y + vehicle.h / 2);
                    if (dist < 40) {
                        player.vehicle = vehicle;
                        vehicle.occupied = true;
                        logEvent('vehicle_boarded', { type: vehicle.type });
                        break;
                    }
                }
            }
        }
    }
});

window.addEventListener('keyup', (e) => {
    // 矢印キーはそのまま、それ以外は小文字化
    const key = e.key.startsWith('Arrow') ? e.key : e.key.toLowerCase();
    gameState.keys[key] = false;
});

function gameLoop() {
    if (!gameState.gameOver) {
        if (gameState.player) gameState.player.update();
        gameState.bullets = gameState.bullets.filter(b => b.update());
        gameState.grenades = gameState.grenades.filter(g => g.update());
        for (const enemy of gameState.enemies) enemy.update();
        for (const vehicle of gameState.vehicles) vehicle.update();
        for (const enemyVehicle of gameState.enemyVehicles) enemyVehicle.update();
        gameState.structures = gameState.structures.filter(s => s.update());
        gameState.airstrikes = gameState.airstrikes.filter(a => a.update());
        gameState.particles = gameState.particles.filter(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.life--;
            return p.life > 0;
        });
        gameState.explosions = gameState.explosions.filter(e => {
            e.life--;
            return e.life > 0;
        });
        updateCamera();
        updateHUD();
    }
    
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);
    
    ctx.fillStyle = '#111';
    for (let y = 0; y < CONFIG.canvasHeight; y += 50) {
        const worldY = y + gameState.camera.y;
        ctx.fillRect(0, y, CONFIG.canvasWidth, 1);
    }
    
    if (gameState.player) gameState.player.draw();
    for (const bullet of gameState.bullets) bullet.draw();
    for (const grenade of gameState.grenades) grenade.draw();
    for (const enemy of gameState.enemies) enemy.draw();
    for (const vehicle of gameState.vehicles) vehicle.draw();
    for (const enemyVehicle of gameState.enemyVehicles) enemyVehicle.draw();
    for (const structure of gameState.structures) structure.draw();
    for (const airstrike of gameState.airstrikes) airstrike.draw();
    
    for (const p of gameState.particles) {
        const screenY = p.y - gameState.camera.y;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, screenY, 2, 2);
    }
    
    for (const e of gameState.explosions) {
        const screenY = e.y - gameState.camera.y;
        const alpha = e.life / e.maxLife;
        ctx.fillStyle = `rgba(255, 170, 0, ${alpha})`;
        ctx.beginPath();
        ctx.arc(e.x, screenY, e.radius * (1 - alpha * 0.5), 0, Math.PI * 2);
        ctx.fill();
    }
    
    // デバッグ情報
    if (CONFIG.debugMode) {
        ctx.fillStyle = '#0f0';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        let debugY = 10;
        ctx.fillText(`FPS: ${Math.round(1000 / 16)}`, 10, debugY); debugY += 12;
        ctx.fillText(`Enemies: ${gameState.enemies.length}`, 10, debugY); debugY += 12;
        ctx.fillText(`Bullets: ${gameState.bullets.length}`, 10, debugY); debugY += 12;
        ctx.fillText(`Vehicles: ${gameState.vehicles.length}`, 10, debugY); debugY += 12;
        ctx.fillText(`Camera Y: ${Math.round(gameState.camera.y)}`, 10, debugY); debugY += 12;
        if (gameState.player) {
            ctx.fillText(`Player: (${Math.round(gameState.player.x)}, ${Math.round(gameState.player.y)})`, 10, debugY);
        }
    }
    
    requestAnimationFrame(gameLoop);
}

initGame();
gameLoop();
