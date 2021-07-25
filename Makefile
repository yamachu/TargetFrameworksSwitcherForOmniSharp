.PHONY: package __publish

package:
	vsce package

__publish:
	vsce publish
