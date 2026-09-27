NODEJS := /mnt/c/Program Files/nodejs/node.exe

PLUGIN := dev.wolfieboy09.deckedoutmc.sdPlugin

SVG_SOURCES := \
	svg/actions/modspace/icon.svg \
	svg/actions/modspace/key.svg \
	svg/plugin/category-icon.svg \
	svg/plugin/marketplace.svg

PNG_TARGETS := \
	$(PLUGIN)/imgs/actions/modspace/icon.png \
	$(PLUGIN)/imgs/actions/modspace/icon@2x.png \
	$(PLUGIN)/imgs/actions/modspace/key.png \
	$(PLUGIN)/imgs/actions/modspace/key@2x.png \
	$(PLUGIN)/imgs/actions/modspace/encoder-icon.png \
	$(PLUGIN)/imgs/actions/modspace/encoder-icon@2x.png \
	$(PLUGIN)/imgs/plugin/category-icon.png \
	$(PLUGIN)/imgs/plugin/category-icon@2x.png \
	$(PLUGIN)/imgs/plugin/marketplace.png \
	$(PLUGIN)/imgs/plugin/marketplace@2x.png

.PHONY: all build icons watch clean

all: build

build: icons $(PLUGIN)/bin/plugin.js

$(PLUGIN)/bin/plugin.js: src/plugin.ts src/bridge.ts src/actions/modspace.ts src/protocol.ts src/config.ts src/pairing.ts src/decks.ts tsconfig.json rollup.config.mjs package.json node_modules
	"$(NODEJS)" node_modules/rollup/dist/bin/rollup -c

icons: $(PNG_TARGETS)

$(PNG_TARGETS): $(SVG_SOURCES) scripts/generate-icons.mjs
	"$(NODEJS)" scripts/generate-icons.mjs

watch:
	"$(NODEJS)" node_modules/rollup/dist/bin/rollup -c -w

clean:
	rm -rf $(PLUGIN)/bin $(PLUGIN)/imgs