.PHONY: build run test
build:
	cd frontend && npm install --no-audit --no-fund && npm run build
	mkdir -p bin
	go build -o bin/kubetree .
run:
	./bin/kubetree
test:
	go test ./...
