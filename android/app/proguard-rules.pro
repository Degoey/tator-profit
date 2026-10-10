# The wrapper is one Activity plus two inner WebView clients: no reflection, no
# serialization and no third-party libraries. `MainActivity` is referenced from
# AndroidManifest.xml, so R8 keeps it (and its entry points) automatically and
# the default Android rules are sufficient.
#
# Keep the line numbers so a stack trace from a field build stays actionable.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
