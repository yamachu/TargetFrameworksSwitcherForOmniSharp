.PHONY: package __publish

package:
	npx vsce package

__publish:
	npx vsce publish
