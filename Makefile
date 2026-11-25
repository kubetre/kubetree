.PHONY: build frontend run test
frontend:
	cd frontend && npm ci --no-audit --no-fund && npm run build
build: frontend
	mkdir -p bin
	go build -o bin/kubetree .
run:
	./bin/kubetree
test: frontend
	go test ./...
