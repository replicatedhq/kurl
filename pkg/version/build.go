package version

import "fmt"

// NOTE: these variables are injected at build time

var (
	version, gitSHA, buildTime string
)

func Print() {
	fmt.Printf("version=%s\nsha=%s\ntime=%s\n", version, gitSHA, buildTime)
}
