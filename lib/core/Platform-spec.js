/**
 * @description RingPlatform JS SDK
 * @copyright © 2014-2015 RingCentral, Inc. All rights reserved.
 */
describe('RCSDK.core.Platform', function() {

    var platform = rcsdk.getPlatform();

    Mock.registerHooks(this);

    describe('isTokenValid', function() {

        it('is not authenticated when token has expired', function() {

            platform.cancelAccessToken();

            expect(platform.isTokenValid()).to.equal(false);

        });

        it('is not authenticated after logout', function(done) {

            platform.logout().then(function() {

                expect(platform.isTokenValid()).to.equal(false);
                done();

            }, done);

        });

    });

    describe('isAuthorized', function() {

        it('initiates refresh if not authorized', function(done) {

            Mock.tokenRefresh();

            expect(platform.getToken()).to.not.equal('ACCESS_TOKEN_FROM_REFRESH');

            platform
                .cancelAccessToken()
                .isAuthorized()
                .then(function() {
                    expect(platform.getToken()).to.equal('ACCESS_TOKEN_FROM_REFRESH');
                    done();
                })
                .catch(done);

        });

        it('waits for refresh to resolve from other tab', function(done) {

            var token = 'ACCESS_TOKEN_FROM_OTHER_TAB';

            expect(platform.getToken()).to.not.equal(token);

            platform
                .pause()
                .cancelAccessToken()
                .isAuthorized()
                .then(function() {
                    expect(platform.getToken()).to.equal(token);
                    done();
                })
                .catch(done);

            setTimeout(function() {

                platform.setCache({
                    access_token: token,
                    expires_in: platform.accessTokenTtl
                });

                platform.resume();

            }, 10);

        });

        it('produces error if refresh did not happen', function(done) {

            var releaseTimeout = platform.releaseTimeout,
                pollInterval = platform.pollInterval;

            platform.releaseTimeout = 20;
            platform.pollInterval = 10;
            platform.refreshPromise = null;

            platform
                .pause()
                .cancelAccessToken()
                .isAuthorized()
                .then(function() {
                    done(new Error('This should not be reached'));
                })
                .catch(function(e) {
                    expect(e.message).to.equal('Automatic authentification timeout');
                    done();
                });

            after(function() {
                platform.releaseTimeout = releaseTimeout;
                platform.pollInterval = pollInterval;
            });

        });

    });

    describe('apiCall', function() {

        it('refreshes token when token was expired', function(done) {

            var path = '/restapi/xxx',
                spy = chai.spy(function() {});

            Mock.tokenRefresh();
            Mock.apiCall(path, {});

            expect(platform.getToken()).to.not.equal('ACCESS_TOKEN_FROM_REFRESH');

            platform
                .cancelAccessToken()
                .on(platform.events.refreshSuccess, spy)
                .apiCall({
                    url: path
                }).then(function(ajax) {
                    expect(spy).to.be.called.once();
                    expect(platform.getToken()).to.equal('ACCESS_TOKEN_FROM_REFRESH');
                    expect(ajax.getOptions().headers.Authorization).to.equal('bearer ACCESS_TOKEN_FROM_REFRESH');
                    done();
                }).catch(done);

        });

        it('tries to refresh the token if Platform returns 401 Unauthorized and re-executes the request', function(done) {

            var path = '/restapi/xxx',
                refreshSpy = chai.spy(function() {}),
                count = 0,
                response = {foo: 'bar'},
                responseSpy = chai.spy(function(ajax) {
                    count++;
                    ajax.setStatus(count == 1 ? 401 : 200);
                    return count == 1 ? {} : response;
                });

            Mock.tokenRefresh();

            rcsdk.getXhrResponse().add({
                path: path,
                response: responseSpy
            });

            platform
                .on(platform.events.refreshSuccess, refreshSpy)
                .apiCall({
                    url: path
                }).then(function(ajax) {

                    expect(refreshSpy).to.be.called.once();
                    expect(responseSpy).to.be.called.twice();
                    expect(ajax.data).to.deep.equal(response);
                    expect(platform.getToken()).to.equal('ACCESS_TOKEN_FROM_REFRESH');
                    expect(ajax.getOptions().headers.Authorization).to.equal('bearer ACCESS_TOKEN_FROM_REFRESH');

                    done();

                }).catch(done);

        });

        it('fails if ajax has status other than 2xx', function(done) {

            var path = '/restapi/xxx';

            rcsdk.getXhrResponse().add({
                path: path,
                response: function(ajax) {
                    ajax.setStatus(400);
                    return {description: 'Fail'};
                }
            });

            platform
                .apiCall({
                    url: path
                }).then(function(ajax) {

                    done(new Error('This should not be reached'));

                }).catch(function(e) {

                    expect(e.message).to.equal('Fail');
                    done();

                });

        });

    });

    describe('refresh', function() {

        it('handles error in queued AJAX after unsuccessful refresh when token is killed', function(done) {

            var path = '/restapi/xxx',
                successSpy = chai.spy(function() {}),
                errorSpy = chai.spy(function() {});

            Mock.tokenRefresh(true);
            Mock.apiCall(path, {});

            platform
                .cancelAccessToken()
                .on(platform.events.refreshSuccess, successSpy)
                .on(platform.events.refreshError, errorSpy)
                .apiCall({
                    url: path
                })
                .then(function() {
                    done(new Error('This should never be called'));
                })
                .catch(function(e) {
                    expect(e.message).to.equal('Wrong token');
                    expect(errorSpy).to.be.called.once();
                    expect(successSpy).not.to.be.called();
                    done();
                });

        });

        it('sits and waits for the queue to be released, no matter how many pending refreshes there are', function(done) {

            platform.pause();

            rcsdk.getContext().getPromise()
                .all([
                    platform.refresh(),
                    platform.refresh(),
                    platform.refresh()
                ])
                .then(function() {
                    done();
                })
                .catch(function(e) {
                    done(e);
                });

            setTimeout(function() {

                platform.resume();

            }, 5);

        });

        it('handles subsequent refreshes', function(done) {

            Mock.tokenRefresh();

            platform.refresh()
                .then(function() {
                    return platform.refresh();
                })
                .then(function() {
                    return rcsdk.getContext().getPromise()
                        .all([
                            platform.refresh(),
                            platform.refresh()
                        ]);
                })
                .then(function() {
                    done();
                })
                .catch(function(e) {
                    done(e);
                });

        });

        it('returns error if response is malformed', function(done) {

            Mock.rcsdk.getXhrResponse().add({
                path: '/restapi/oauth/token',
                /**
                 * @param {XhrMock} ajax
                 * @returns {Object}
                 */
                response: function(ajax) {

                    ajax.setStatus(240); // This weird status were caught on client's machine

                    return {
                        'message': 'Wrong token',
                        'error_description': 'Wrong token',
                        'description': 'Wrong token'
                    };

                }
            });

            platform.cancelAccessToken().refresh().then(function() {
                done(new Error('This should not be reached'));
            }).catch(function(e) {
                expect(e.message).to.equal('Malformed OAuth response');
                expect(e.ajax.data.message).to.equal('Wrong token');
                done();
            });

        });

    });

    describe('refreshPolling', function() {

        beforeEach(function() {
            platform.refreshPromise = null;
            this.releaseTimeout = platform.releaseTimeout;
            this.pollInterval = platform.pollInterval;
            platform.releaseTimeout = 20;
            platform.pollInterval = 10;
        });

        afterEach(function() {
            platform.releaseTimeout = this.releaseTimeout;
            platform.pollInterval = this.pollInterval;
        });

        it('polls the status of semaphor and resumes operation', function(done) {

            platform
                .pause()
                .refreshPolling(null)
                .then(function() {
                    done();
                })
                .catch(done);

            setTimeout(function() {
                platform.resume();
            }, 10);

        });

        it('resolves with error if token is not valid after releaseTimeout', function(done) {

            platform
                .pause() // resume() will not be called in this test
                .cancelAccessToken()
                .refreshPolling(null)
                .then(function() {
                    done(new Error('This should not be reached'));
                })
                .catch(function(e) {
                    expect(e.message).to.equal('Automatic authentification timeout');
                    done();
                });

        });

    });

});