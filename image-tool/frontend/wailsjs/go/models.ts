export namespace backend {
	
	export class BatchProcessResult {
	    success: boolean;
	    totalFiles: number;
	    successCount: number;
	    failureCount: number;
	    totalOriginalSize: number;
	    totalOutputSize: number;
	    outputDir?: string;
	    message: string;
	    failures: string[];
	
	    static createFrom(source: any = {}) {
	        return new BatchProcessResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.totalFiles = source["totalFiles"];
	        this.successCount = source["successCount"];
	        this.failureCount = source["failureCount"];
	        this.totalOriginalSize = source["totalOriginalSize"];
	        this.totalOutputSize = source["totalOutputSize"];
	        this.outputDir = source["outputDir"];
	        this.message = source["message"];
	        this.failures = source["failures"];
	    }
	}
	export class CompressionQuality {
	    percent: number;
	
	    static createFrom(source: any = {}) {
	        return new CompressionQuality(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.percent = source["percent"];
	    }
	}
	export class ImageFileInfo {
	    path: string;
	    fileName: string;
	    size: number;
	    width: number;
	    height: number;
	    previewDataUrl?: string;
	
	    static createFrom(source: any = {}) {
	        return new ImageFileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.fileName = source["fileName"];
	        this.size = source["size"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.previewDataUrl = source["previewDataUrl"];
	    }
	}
	export class ProcessResult {
	    success: boolean;
	    outputPath: string;
	    originalSize: number;
	    outputSize: number;
	    message: string;
	    steps: string[];
	    durationMs: number;
	
	    static createFrom(source: any = {}) {
	        return new ProcessResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.outputPath = source["outputPath"];
	        this.originalSize = source["originalSize"];
	        this.outputSize = source["outputSize"];
	        this.message = source["message"];
	        this.steps = source["steps"];
	        this.durationMs = source["durationMs"];
	    }
	}
	export class ProcessingOptions {
	    convertFormat?: string;
	    resizeMode?: string;
	    resizeWidth?: number;
	    resizeHeight?: number;
	    resizeScale?: number;
	    compressionType?: string;
	    compressionPreset?: string;
	    compressionQuality?: CompressionQuality;
	    targetRatio?: number;
	
	    static createFrom(source: any = {}) {
	        return new ProcessingOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.convertFormat = source["convertFormat"];
	        this.resizeMode = source["resizeMode"];
	        this.resizeWidth = source["resizeWidth"];
	        this.resizeHeight = source["resizeHeight"];
	        this.resizeScale = source["resizeScale"];
	        this.compressionType = source["compressionType"];
	        this.compressionPreset = source["compressionPreset"];
	        this.compressionQuality = this.convertValues(source["compressionQuality"], CompressionQuality);
	        this.targetRatio = source["targetRatio"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

