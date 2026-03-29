package llms

import (
	"bufio"
	"io"
	"strings"
)

type sseEvent struct {
	Event string
	Data  string
}

func consumeSSEStream(reader io.Reader, onEvent func(sseEvent) error) (string, error) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)

	var raw strings.Builder
	current := sseEvent{}
	dataLines := make([]string, 0, 4)

	dispatch := func() error {
		if current.Event == "" && len(dataLines) == 0 {
			return nil
		}
		event := sseEvent{
			Event: current.Event,
			Data:  strings.Join(dataLines, "\n"),
		}
		current = sseEvent{}
		dataLines = dataLines[:0]
		return onEvent(event)
	}

	for scanner.Scan() {
		line := scanner.Text()
		raw.WriteString(line)
		raw.WriteByte('\n')

		if line == "" {
			if err := dispatch(); err != nil {
				return raw.String(), err
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		if strings.HasPrefix(line, "event:") {
			current.Event = trimSSEFieldValue(line[len("event:"):])
			continue
		}
		if strings.HasPrefix(line, "data:") {
			dataLines = append(dataLines, trimSSEFieldValue(line[len("data:"):]))
		}
	}

	if err := scanner.Err(); err != nil {
		return raw.String(), err
	}
	if err := dispatch(); err != nil {
		return raw.String(), err
	}

	return raw.String(), nil
}

func trimSSEFieldValue(value string) string {
	if strings.HasPrefix(value, " ") {
		return value[1:]
	}
	return value
}

func isEventStreamContentType(contentType string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(contentType)), "text/event-stream")
}
