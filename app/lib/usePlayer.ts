import { useRef, useState } from "react";

export function usePlayer() {
	const [isPlaying, setIsPlaying] = useState(false);
	const audioContext = useRef<AudioContext | null>(null);
	const source = useRef<AudioBufferSourceNode | null>(null);

	async function play(stream: ReadableStream, callback: () => void) {
		stop();
		audioContext.current = new AudioContext({ sampleRate: 16000 });

		let nextStartTime = audioContext.current.currentTime;
		const reader = stream.getReader();
		let leftover = new Uint8Array();
		let result = await reader.read();
		setIsPlaying(true);

		while (!result.done && audioContext.current) {
			const data = new Uint8Array(leftover.length + result.value.length);
			data.set(leftover);
			data.set(result.value, leftover.length);

			const length = Math.floor(data.length / 2);
			const remainder = data.length % 2;
			const buffer = new Int16Array(data.buffer, 0, length);

			leftover = new Uint8Array(data.buffer, length * 2, remainder);

			const buffer32 = new Float32Array(buffer.length);
			for (let i = 0; i < buffer.length; i++) {
				buffer32[i] = buffer[i] / 32768.0;
			}

			const audioBuffer = audioContext.current.createBuffer(
				1,
				buffer32.length,
				audioContext.current.sampleRate
			);
			audioBuffer.copyToChannel(buffer32, 0);

			source.current = audioContext.current.createBufferSource();
			source.current.buffer = audioBuffer;
			source.current.connect(audioContext.current.destination);
			source.current.start(nextStartTime);

			nextStartTime += audioBuffer.duration;

			result = await reader.read();
			if (result.done) {
				source.current.onended = () => {
					stop();
					callback();
				};
			}
		}
	}

	function stop() {
		audioContext.current?.close();
		audioContext.current = null;
		setIsPlaying(false);
	}

	return {
		isPlaying,
		play,
		stop,
	};
}
