export function writeVcsBatchForTracks(
  vcsVideoInputTrackDescs,
  {
    durationInFrames = 0,
    fps = 30,
    outputSize = { w: 1280, h: 720 },
    initialParams = {},
  }
) {
  const vcsBatch = {
    compositionId: 'daily:baseline',
    durationInFrames,
    framesPerSecond: fps,
    outputSize,
    eventsByFrame: {},
  };

  let activeVideoInputSlots = [];

  vcsBatch.eventsByFrame[0] = {
    activeVideoInputSlots,
    params: { ...initialParams },
  };

  // Build maps for both start and end frames
  const videoTrackIndexesByStartFrame = new Map();
  const videoTrackIndexesByEndFrame = new Map();

  for (const [idx, track] of vcsVideoInputTrackDescs.entries()) {
    const { startOffsetSecs = 0, durationInSecs = 0 } = track;
    const startFrame = Math.round(startOffsetSecs * fps);

    const arr = videoTrackIndexesByStartFrame.get(startFrame) ?? [];
    arr.push(idx);
    videoTrackIndexesByStartFrame.set(startFrame, arr);

    // Calculate end frame if duration is available
    if (durationInSecs > 0) {
      const endFrame = Math.round((startOffsetSecs + durationInSecs) * fps);
      const endArr = videoTrackIndexesByEndFrame.get(endFrame) ?? [];
      endArr.push(idx);
      videoTrackIndexesByEndFrame.set(endFrame, endArr);
    }
  }

  // Collect all frames where something changes (start or end)
  const allChangeFrames = new Set([
    ...videoTrackIndexesByStartFrame.keys(),
    ...videoTrackIndexesByEndFrame.keys(),
  ]);
  const sortedChangeFrames = [...allChangeFrames].sort((a, b) => a - b);

  for (const frameIdx of sortedChangeFrames) {
    const tracksStartingHere = videoTrackIndexesByStartFrame.get(frameIdx) ?? [];
    const tracksEndingHere = videoTrackIndexesByEndFrame.get(frameIdx) ?? [];

    // Skip if nothing changes at this frame
    if (tracksStartingHere.length === 0 && tracksEndingHere.length === 0) {
      continue;
    }

    const batchEv = vcsBatch.eventsByFrame[frameIdx] ?? {};
    activeVideoInputSlots = [...activeVideoInputSlots];

    // First remove tracks that are ending
    for (const trackIdx of tracksEndingHere) {
      activeVideoInputSlots[trackIdx] = null;
    }

    // Then add tracks that are starting
    for (const trackIdx of tracksStartingHere) {
      const t = vcsVideoInputTrackDescs[trackIdx];
      activeVideoInputSlots[trackIdx] = {
        id: t.videoInputId,
        displayName: t.participantId ?? `track${trackIdx}`,
      };
    }

    batchEv.activeVideoInputSlots = activeVideoInputSlots;

    vcsBatch.eventsByFrame[frameIdx] = batchEv;
  }

  return vcsBatch;

  for (const cutEv of cutEvents) {
    /*
      {
        "t": "3",
        "clips": ["s1"],
        "params": {
          "showTitleSlate": false
        }
      }
    */
    const { t: tc, clips, params } = cutEv;
    const t = parseClipTime(tc);
    const frame = Math.floor(t * fps);
    const batchEv = {};

    if (clips?.length > 0) {
      for (const clipId of clips) {
        const rclip = renderedClips.find((rc) => rc.clip?.id === clipId);
        if (!rclip) {
          throw new Error(`Cut specifies clip '${clipId}' that doesn't exist`);
        }
        const { videoInputId, seqDir, w, h, fps } = rclip;
        const { duration: durationTc } = rclip.clip;
        const duration = parseClipTime(durationTc);

        vcsRenderInputTimings.playbackEvents.push({
          frame,
          videoInputId,
          durationInFrames: Math.ceil(duration * fps),
          clipId,
          seqDir,
          w,
          h,
        });

        if (!batchEv.activeVideoInputSlots) batchEv.activeVideoInputSlots = [];
        batchEv.activeVideoInputSlots.push({
          id: videoInputId,
        });
      }
    }

    if (params && Object.keys(params).length > 0) {
      batchEv.params = { ...params };
    }

    vcsBatch.eventsByFrame[frame] = batchEv;
  }

  // -- write
  const batchJson = JSON.stringify(vcsBatch, null, 2);
  const inputTimings = JSON.stringify(vcsRenderInputTimings, null, 2);

  const batchOutFile = `${outFilePrefix}.vcsevents.json`;
  const inputTimingsOutFile = `${outFilePrefix}.vcsinputtimings.json`;

  fs.writeFileSync(batchOutFile, batchJson, { encoding: 'utf8' });
  fs.writeFileSync(inputTimingsOutFile, inputTimings, { encoding: 'utf8' });

  console.log(
    'JSON written to two files:\n%s\n%s',
    Path.resolve(batchOutFile),
    Path.resolve(inputTimingsOutFile)
  );
}
