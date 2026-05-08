package backend

import (
	"log"
	"net/http"
	"os"

	wailsAssetServer "github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

func isDevMode() bool {
	return os.Getenv("frontenddevserverurl") != "" || os.Getenv("devserver") != ""
}

func newLocalFileHandler() http.Handler {
	return http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		path := req.URL.Query().Get("path")
		if path == "" {
			http.Error(rw, "missing path", http.StatusBadRequest)
			return
		}

		if isDevMode() {
			log.Printf("[local-file] request path=%q url=%q", path, req.URL.String())
		}

		info, err := os.Stat(path)
		if err != nil {
			if os.IsNotExist(err) {
				http.NotFound(rw, req)
				return
			}
			http.Error(rw, err.Error(), http.StatusInternalServerError)
			return
		}
		if info.IsDir() {
			http.Error(rw, "path is a directory", http.StatusBadRequest)
			return
		}

		http.ServeFile(rw, req, path)
	})
}

func newLocalFileMiddleware() wailsAssetServer.Middleware {
	localFileHandler := newLocalFileHandler()

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
			if req.URL.Path == "/local-file" {
				localFileHandler.ServeHTTP(rw, req)
				return
			}

			next.ServeHTTP(rw, req)
		})
	}
}
