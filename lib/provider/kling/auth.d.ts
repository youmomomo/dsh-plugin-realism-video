export declare function signJwt(ak: string, sk: string, nowSec: number): string;
export declare class KlingAuth {
    private readonly ak;
    private readonly sk;
    private readonly now;
    private cached;
    constructor(ak: string, sk: string, now?: () => number);
    getToken(): string;
    invalidate(): void;
}
