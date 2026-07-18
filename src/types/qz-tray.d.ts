// Minimal typed surface for qz-tray (no official/@types package exists).
// Only covers the calls this codebase actually uses — see qz.io docs for the full API.
declare module 'qz-tray' {
    interface ConnectOptions {
        host?: string | string[]
        retries?: number
        delay?: number
        keepAlive?: number
    }

    interface PrintConfigOptions {
        [key: string]: unknown
    }

    interface PrintConfig {
        getPrinter(): string | { name?: string; file?: string; host?: string; port?: string }
        getOptions(): PrintConfigOptions
    }

    interface PrintData {
        type?: 'raw' | 'pixel'
        format?: 'command' | 'html' | 'image' | 'pdf'
        flavor?: 'base64' | 'file' | 'hex' | 'plain' | 'xml'
        data: string
        options?: Record<string, unknown>
    }

    const qz: {
        websocket: {
            connect(options?: ConnectOptions): Promise<void>
            disconnect(): Promise<void>
            isActive(): boolean
        }
        printers: {
            find(query?: string): Promise<string[] | string>
            getDefault(): Promise<string>
        }
        configs: {
            // A printer name (USB/OS queue) or a raw network socket target.
            create(printer: string | { host: string; port: number }, options?: PrintConfigOptions): PrintConfig
        }
        print(config: PrintConfig | PrintConfig[], data: (PrintData | string)[]): Promise<void>
        security: {
            setCertificatePromise(handler: (resolve: (cert: string) => void, reject: (err: unknown) => void) => void): void
            setSignaturePromise(handler: (toSign: string) => (resolve: (sig: string) => void, reject: (err: unknown) => void) => void): void
            setSignatureAlgorithm?(algorithm: 'SHA1' | 'SHA256' | 'SHA512'): void
        }
        api: {
            setPromiseType(factory: (resolver: (resolve: (v?: unknown) => void, reject: (err: unknown) => void) => void) => Promise<unknown>): void
        }
    }

    export default qz
}
