package com.vinaykpro.ludoking;

import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class AutoSixTest {
    @Test
    public void autoSixRepeatsWhenNoOneTimeCommandExists() {
        assertEquals(6, ControlClient.resolveDice(0, true));
        assertEquals(6, ControlClient.resolveDice(0, true));
        assertEquals(6, ControlClient.resolveDice(0, true));
    }

    @Test
    public void oneTimeCommandOverridesAndDisabledModeIsNormal() {
        assertEquals(5, ControlClient.resolveDice(5, true));
        assertEquals(0, ControlClient.resolveDice(0, false));
    }
}
